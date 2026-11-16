import { Inject, Injectable } from '@nestjs/common';
import type { NumberSeriesKind, Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import {
  renderNumberSeriesFormat,
  validateNumberSeriesFormat,
  type NumberSeriesFormat,
} from '../opd-masters/number-series-format';
import { resolvePeriodYear } from '../patients/uhid.util';

@Injectable()
export class NumberSeriesService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /**
   * Allocate next number on the caller's TenantDb transaction (no own transaction).
   * Rollback of the caller leaves no gap.
   */
  async allocate(input: {
    tenantId: string;
    series: NumberSeriesKind;
    tx: Prisma.TransactionClient;
    now?: Date;
  }): Promise<{ formatted: string; number: bigint; periodYear: number }> {
    const now = input.now ?? this.clock.now();
    const tx = input.tx;

    const settings = await tx.numberSeriesSettings.findUnique({
      where: {
        tenantId_series: { tenantId: input.tenantId, series: input.series },
      },
    });
    if (!settings) {
      throw new Error(
        `No number_series_settings for series ${input.series}; configure the hospital series first`,
      );
    }

    const opd = await tx.opdSettings.findUnique({ where: { tenantId: input.tenantId } });
    const timeZone = opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;

    const format = settings.format as NumberSeriesFormat;
    validateNumberSeriesFormat(format);

    const periodYear = resolvePeriodYear(now, settings.resetRule, settings.fyStartMonth, timeZone);

    await tx.$executeRaw`
      INSERT INTO number_series (tenant_id, series, period_year, last_number)
      VALUES (${input.tenantId}, ${input.series}::number_series_kind, ${periodYear}, 0)
      ON CONFLICT (tenant_id, series, period_year) DO NOTHING
    `;
    await tx.$executeRaw`
      SELECT last_number FROM number_series
      WHERE tenant_id = ${input.tenantId}
        AND series = ${input.series}::number_series_kind
        AND period_year = ${periodYear}
      FOR UPDATE
    `;
    const updated = await tx.$queryRaw<Array<{ last_number: bigint }>>`
      UPDATE number_series
      SET last_number = last_number + 1
      WHERE tenant_id = ${input.tenantId}
        AND series = ${input.series}::number_series_kind
        AND period_year = ${periodYear}
      RETURNING last_number
    `;
    const number = updated[0]!.last_number;

    const financialYear =
      settings.resetRule === 'FINANCIAL_YEAR'
        ? periodYear
        : resolvePeriodYear(now, 'FINANCIAL_YEAR', settings.fyStartMonth, timeZone);

    const formatted = renderNumberSeriesFormat(format, {
      financialYear,
      running: number,
    });

    return { formatted, number, periodYear };
  }
}
