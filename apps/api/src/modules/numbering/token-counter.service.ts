import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { zonedParts } from '../patients/uhid.util';

/**
 * OPD queue token counters (one series per branch per hospital local day).
 * Named TokenCounterService to avoid clashing with auth TokenService (JWT).
 */
@Injectable()
export class TokenCounterService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  async allocate(input: {
    tenantId: string;
    branchId: string;
    tx: Prisma.TransactionClient;
    now?: Date;
  }): Promise<{ tokenDate: string; tokenNo: number; label: string }> {
    const now = input.now ?? this.clock.now();
    const tx = input.tx;

    const opd = await tx.opdSettings.findUnique({ where: { tenantId: input.tenantId } });
    const timeZone = opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
    const prefix = opd?.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix;

    const { year, month, day } = zonedParts(now, timeZone);
    const tokenDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const tokenDateSql = new Date(`${tokenDate}T00:00:00.000Z`);

    await tx.$executeRaw`
      INSERT INTO token_counters (tenant_id, branch_id, token_date, last_token)
      VALUES (${input.tenantId}, ${input.branchId}, ${tokenDateSql}::date, 0)
      ON CONFLICT (tenant_id, branch_id, token_date) DO NOTHING
    `;
    await tx.$executeRaw`
      SELECT last_token FROM token_counters
      WHERE tenant_id = ${input.tenantId}
        AND branch_id = ${input.branchId}
        AND token_date = ${tokenDateSql}::date
      FOR UPDATE
    `;
    const updated = await tx.$queryRaw<Array<{ last_token: number }>>`
      UPDATE token_counters
      SET last_token = last_token + 1
      WHERE tenant_id = ${input.tenantId}
        AND branch_id = ${input.branchId}
        AND token_date = ${tokenDateSql}::date
      RETURNING last_token
    `;
    const tokenNo = Number(updated[0]!.last_token);
    return { tokenDate, tokenNo, label: `${prefix}${tokenNo}` };
  }
}
