import { Injectable } from '@nestjs/common';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { STAFF_CODE_LIMITS } from './staff.config';
import { formatStaffCode, readCodeFormat } from './staff.rules';

export type StaffCodeFormat = {
  prefix: string;
  minWidth: number;
  /** A sample of the next code. */
  next: string;
  limits: typeof STAFF_CODE_LIMITS;
};

/**
 * The staff code of a user (STF001, STF002, ...): the prefix and the least number of digits are the
 * hospital's own choice, the number only goes up. A code already used by someone (for example a code
 * typed in an older setup) is skipped, so a code never repeats.
 */
@Injectable()
export class StaffCodeService {
  constructor(private readonly tenantDb: TenantDb) {}

  async get(tenantId: string): Promise<StaffCodeFormat> {
    return this.tenantDb.withTenant(async (tx) => {
      const row = await tx.staffCodeSettings.findUnique({ where: { tenantId } });
      const prefix = row?.prefix ?? STAFF_CODE_LIMITS.defaultPrefix;
      const minWidth = row?.minWidth ?? STAFF_CODE_LIMITS.defaultMinWidth;
      return {
        prefix,
        minWidth,
        next: formatStaffCode(prefix, minWidth, (row?.lastNumber ?? 0n) + 1n),
        limits: STAFF_CODE_LIMITS,
      };
    });
  }

  /** Changes how new codes look. Codes already given never change. */
  async set(actor: { tenantId: string; userId: string }, body: unknown): Promise<StaffCodeFormat> {
    const format = readCodeFormat(body);
    await this.tenantDb.withTenant(async (tx) => {
      await tx.staffCodeSettings.upsert({
        where: { tenantId: actor.tenantId },
        create: { tenantId: actor.tenantId, prefix: format.prefix, minWidth: format.minWidth },
        update: { prefix: format.prefix, minWidth: format.minWidth },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'STAFF_CODE_FORMAT_CHANGE',
          entityType: 'staff_code_settings',
          entityId: actor.tenantId,
          reason: 'Staff code format changed',
          metadata: { changed: ['prefix', 'minWidth'] },
        },
      });
    });
    return this.get(actor.tenantId);
  }

  /** The next free code, inside the transaction that creates the user. */
  async next(tx: TenantTx, tenantId: string): Promise<string> {
    await tx.staffCodeSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = await tx.staffCodeSettings.update({
        where: { tenantId },
        data: { lastNumber: { increment: 1 } },
      });
      const code = formatStaffCode(row.prefix, row.minWidth, row.lastNumber);
      const taken = await tx.user.findFirst({
        where: { tenantId, code: { equals: code, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!taken) {
        return code;
      }
    }
    throw new Error('No free staff code found');
  }
}
