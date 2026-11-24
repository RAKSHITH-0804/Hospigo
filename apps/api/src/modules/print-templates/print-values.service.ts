import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import type { Actor } from '../opd-visits/opd-visits.service';
import {
  PRINT_VALUE_LIMITS,
  PrintValueRuleError,
  parsePrintValueCreate,
  parsePrintValuePatch,
  printValueField,
} from './print-values.rules';
import { assertMayChangePrint, type PrintScope } from './print-scope';

export const PRINT_VALUE_AUDIT = {
  action: 'PRINT_VALUE_CHANGE',
  entityType: 'print_value',
} as const;

export type PrintValueView = {
  id: string;
  key: string;
  /** The name of the value inside a template (value.<key>). */
  field: string;
  label: string;
  value: string;
  active: boolean;
  scope: 'BRANCH' | 'HOSPITAL';
};

/** What a print page needs: the value that applies to the signed-in branch. */
export type EffectivePrintValue = { key: string; field: string; label: string; text: string };

function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PrintValueRuleError) {
      throw opdError(400, OpdErrorCode.PRINT_VALUE_INVALID, {
        field: error.field,
        reason: error.reason,
      });
    }
    throw error;
  }
}

const conflict = (reason: string): never => {
  throw opdError(409, OpdErrorCode.PRINT_VALUE_CONFLICT, { reason });
};

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } } | null;
  return (
    e?.code === 'P2002' ||
    e?.code === '23505' ||
    e?.cause?.code === '23505' ||
    (typeof e?.message === 'string' && /duplicate key|unique constraint/i.test(e.message))
  );
}

/**
 * Extra print values (Step 8c): named plain-text values an Admin puts into a print template. A value
 * belongs to the whole hospital or to the signed-in branch (the branch comes from the token, never
 * from the request). Changing a hospital value needs the permission in every branch, a branch value
 * only in the signed-in branch (the same rule as the templates). A branch value with the same key
 * replaces the hospital value for that branch, even when the branch value is switched off (that is how
 * one branch turns a hospital value off for itself). Values are never deleted, only switched off.
 * Audit holds the value id, its key (a code), the scope and the NAMES of what changed, never the text.
 */
@Injectable()
export class PrintValuesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private view(r: Prisma.PrintValueGetPayload<object>): PrintValueView {
    return {
      id: r.id,
      key: r.key,
      field: printValueField(r.key),
      label: r.label,
      value: r.value,
      active: r.active,
      scope: r.branchId ? 'BRANCH' : 'HOSPITAL',
    };
  }

  private visible(actor: Actor): Prisma.PrintValueWhereInput {
    return { tenantId: actor.tenantId, OR: [{ branchId: null }, { branchId: actor.branchId }] };
  }

  /** The values that apply to the signed-in branch (for the print pages and the designer list). */
  async effective(actor: Actor): Promise<{ items: EffectivePrintValue[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.printValue.findMany({
        where: this.visible(actor),
        orderBy: [{ label: 'asc' }, { key: 'asc' }],
      });
      const own = new Set(rows.filter((r) => r.branchId).map((r) => r.key));
      const chosen = rows
        .filter((r) => (r.branchId ? true : !own.has(r.key)))
        .filter((r) => r.active);
      return {
        items: chosen.map((r) => ({
          key: r.key,
          field: printValueField(r.key),
          label: r.label,
          text: r.value,
        })),
      };
    });
  }

  /** Every value of the hospital and of this branch, switched off ones too (for the Admin screen). */
  async manage(actor: Actor): Promise<{
    items: PrintValueView[];
    canChange: { branch: boolean; hospital: boolean };
    limits: typeof PRINT_VALUE_LIMITS;
  }> {
    const [canBranch, canHospital] = await Promise.all([
      this.access.can('opd.settings.write', actor.branchId, 'OPD'),
      this.access
        .hospitalWideBranches('opd.settings.write', 'OPD')
        .then((branches) => branches.length > 0),
    ]);
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.printValue.findMany({
        where: this.visible(actor),
        orderBy: [{ active: 'desc' }, { label: 'asc' }, { key: 'asc' }],
      });
      return {
        items: rows.map((r) => this.view(r)),
        canChange: { branch: canBranch, hospital: canHospital },
        limits: PRINT_VALUE_LIMITS,
      };
    });
  }

  async create(actor: Actor, scope: PrintScope, body: unknown): Promise<PrintValueView> {
    await assertMayChangePrint(this.access, actor, scope);
    const input = parsed(() => parsePrintValueCreate(body));
    const branchId = scope === 'branch' ? actor.branchId : null;
    try {
      return await this.tenantDb.withTenant(async (tx) => {
        // one lock per hospital: two adds at the same moment see each other (limit, same key)
        await tx.opdSettings.updateMany({
          where: { tenantId: actor.tenantId },
          data: { updatedAt: this.clock.now() },
        });
        const count = await tx.printValue.count({ where: { tenantId: actor.tenantId, branchId } });
        if (count >= PRINT_VALUE_LIMITS.perScopeMax) {
          return conflict('TOO_MANY');
        }
        const same = await tx.printValue.findFirst({
          where: { tenantId: actor.tenantId, branchId, key: input.key },
          select: { id: true },
        });
        if (same) {
          return conflict('KEY_EXISTS');
        }
        const created = await tx.printValue.create({
          data: {
            tenantId: actor.tenantId,
            branchId,
            key: input.key,
            label: input.label,
            value: input.value,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
        });
        await this.audit(tx, actor, created.id, {
          kind: 'ADD',
          key: input.key,
          scope: scope === 'branch' ? 'BRANCH' : 'HOSPITAL',
        });
        return this.view(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return conflict('KEY_EXISTS');
      }
      throw error;
    }
  }

  async update(actor: Actor, id: string, body: unknown): Promise<PrintValueView> {
    const patch = parsed(() => parsePrintValuePatch(body));
    return this.tenantDb.withTenant(async (tx) => {
      await tx.opdSettings.updateMany({
        where: { tenantId: actor.tenantId },
        data: { updatedAt: this.clock.now() },
      });
      // the value of another branch looks like "not found"
      const row = await tx.printValue.findFirst({ where: { id, ...this.visible(actor) } });
      if (!row) {
        throw opdError(404, OpdErrorCode.PRINT_VALUE_NOT_FOUND);
      }
      const scope: PrintScope = row.branchId ? 'branch' : 'hospital';
      await assertMayChangePrint(this.access, actor, scope);
      const changed: string[] = [];
      if (patch.label !== undefined && patch.label !== row.label) changed.push('label');
      if (patch.value !== undefined && patch.value !== row.value) changed.push('value');
      if (patch.active !== undefined && patch.active !== row.active) changed.push('active');
      if (changed.length === 0) {
        return this.view(row);
      }
      const saved = await tx.printValue.update({
        where: { id },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.value !== undefined ? { value: patch.value } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          updatedBy: actor.userId,
          updatedAt: this.clock.now(),
        },
      });
      await this.audit(tx, actor, id, {
        kind: 'CHANGE',
        key: row.key,
        scope: row.branchId ? 'BRANCH' : 'HOSPITAL',
        changed,
      });
      return this.view(saved);
    });
  }

  private async audit(
    tx: TenantTx,
    actor: Actor,
    id: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        branchId: actor.branchId,
        action: PRINT_VALUE_AUDIT.action,
        entityType: PRINT_VALUE_AUDIT.entityType,
        entityId: id,
        metadata,
      },
    });
  }
}
