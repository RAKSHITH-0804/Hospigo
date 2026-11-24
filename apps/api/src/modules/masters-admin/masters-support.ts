import type { Prisma } from '../../generated/prisma';
import type { TenantTx } from '../../database/tenant-db';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { MasterRuleError } from './masters.rules';

export type MasterActor = { tenantId: string; userId: string };

/** Run a parser and turn its refusal into the API error (field and reason, plain codes). */
export function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MasterRuleError) {
      throw opdError(400, OpdErrorCode.MASTER_INVALID, {
        field: error.field,
        reason: error.reason,
      });
    }
    throw error;
  }
}

export const invalid = (field: string, reason: string): never => {
  throw opdError(400, OpdErrorCode.MASTER_INVALID, { field, reason });
};

export const conflict = (reason: string): never => {
  throw opdError(409, OpdErrorCode.MASTER_CONFLICT, { reason });
};

export const notFound = (): never => {
  throw opdError(404, OpdErrorCode.MASTER_NOT_FOUND);
};

/**
 * Takes the lock of the hospital settings row for the rest of the transaction, so two changes of
 * the same kind of master at the same moment run one after the other and see each other.
 */
export async function lockMasters(tx: TenantTx, tenantId: string, now: Date): Promise<void> {
  await tx.opdSettings.updateMany({ where: { tenantId }, data: { updatedAt: now } });
}

/** The audit trail keeps ids and field NAMES, never what was typed. */
export async function auditMaster(
  tx: TenantTx,
  actor: MasterActor,
  audit: { action: string; entityType: string },
  entityId: string,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: audit.action,
      entityType: audit.entityType,
      entityId,
      reason: 'Admin changed a master list',
      metadata,
    },
  });
}

export const num = (d: { toString(): string } | null): number | null =>
  d === null ? null : Number(d.toString());
