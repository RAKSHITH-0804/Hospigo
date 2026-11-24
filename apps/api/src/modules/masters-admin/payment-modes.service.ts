import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb } from '../../database/tenant-db';
import { MASTERS_AUDIT, MASTERS_CONFIG as C } from './masters.config';
import {
  parsePaymentModeCreate,
  parsePaymentModePatch,
  type PaymentModePatch,
} from './masters.rules';
import {
  auditMaster,
  conflict,
  lockMasters,
  notFound,
  parsed,
  type MasterActor,
} from './masters-support';

export type PaymentModeView = {
  id: string;
  code: string;
  name: string;
  requiresReference: boolean;
  active: boolean;
  /** The mode billing uses when none is chosen: it cannot be switched off. */
  isDefault: boolean;
  /** How many payments were taken with it (it can never be deleted, only switched off). */
  paymentsCount: number;
};

/**
 * Payment modes of the hospital (Step 8c): add, rename, switch off and on, and the "reference
 * needed" flag. A mode is never deleted (payments and refunds point at it) and its code never
 * changes. The flag decides for NEW payments and refunds only: payments already taken are untouched.
 * The check that a reference is given for such a mode lives in the billing code and is unchanged.
 */
@Injectable()
export class PaymentModesService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: MasterActor): Promise<{ items: PaymentModeView[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const modes = await tx.paymentMode.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
      });
      const counts = await tx.payment.groupBy({
        by: ['paymentModeId'],
        where: { tenantId: actor.tenantId },
        _count: { _all: true },
      });
      const used = new Map(counts.map((c) => [c.paymentModeId, c._count._all]));
      return {
        items: modes.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          requiresReference: m.requiresReference,
          active: m.active,
          isDefault: m.code === C.defaultPaymentModeCode,
          paymentsCount: used.get(m.id) ?? 0,
        })),
      };
    });
  }

  async create(actor: MasterActor, body: unknown): Promise<PaymentModeView> {
    const input = parsed(() => parsePaymentModeCreate(body));
    const id = await this.tenantDb.withTenant(async (tx) => {
      await lockMasters(tx, actor.tenantId, this.clock.now());
      if (
        (await tx.paymentMode.count({ where: { tenantId: actor.tenantId } })) >= C.paymentModesMax
      ) {
        return conflict('TOO_MANY');
      }
      if (
        await tx.paymentMode.findFirst({ where: { tenantId: actor.tenantId, code: input.code } })
      ) {
        return conflict('CODE_USED');
      }
      const created = await tx.paymentMode.create({
        data: {
          tenantId: actor.tenantId,
          code: input.code,
          name: input.name,
          requiresReference: input.requiresReference,
        },
        select: { id: true },
      });
      await auditMaster(tx, actor, MASTERS_AUDIT.paymentMode, created.id, { kind: 'CREATE' });
      return created.id;
    });
    return this.one(actor, id);
  }

  async update(actor: MasterActor, id: string, body: unknown): Promise<PaymentModeView> {
    const patch: PaymentModePatch = parsed(() => parsePaymentModePatch(body));
    await this.tenantDb.withTenant(async (tx) => {
      await lockMasters(tx, actor.tenantId, this.clock.now());
      const mode = await tx.paymentMode.findFirst({ where: { id, tenantId: actor.tenantId } });
      if (!mode) {
        return notFound();
      }
      const changed: string[] = [];
      if (patch.name !== undefined && patch.name !== mode.name) changed.push('name');
      if (
        patch.requiresReference !== undefined &&
        patch.requiresReference !== mode.requiresReference
      ) {
        changed.push('requiresReference');
      }
      if (patch.active !== undefined && patch.active !== mode.active) changed.push('active');
      if (changed.length === 0) {
        return undefined;
      }
      if (patch.active === false && mode.active) {
        if (mode.code === C.defaultPaymentModeCode) {
          return conflict('DEFAULT_MODE');
        }
        const others = await tx.paymentMode.count({
          where: { tenantId: actor.tenantId, active: true, id: { not: id } },
        });
        if (others === 0) {
          return conflict('LAST_ACTIVE');
        }
      }
      await tx.paymentMode.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.requiresReference !== undefined
            ? { requiresReference: patch.requiresReference }
            : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
        },
      });
      await auditMaster(tx, actor, MASTERS_AUDIT.paymentMode, id, { kind: 'UPDATE', changed });
      return undefined;
    });
    return this.one(actor, id);
  }

  private async one(actor: MasterActor, id: string): Promise<PaymentModeView> {
    const { items } = await this.list(actor);
    const found = items.find((m) => m.id === id);
    return found ?? notFound();
  }
}
