import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import {
  renderNumberSeriesFormat,
  type NumberSeriesFormat,
} from '../opd-masters/number-series-format';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { localDate } from '../opd-prices/local-date';
import { resolvePeriodYear } from '../patients/uhid.util';
import { MASTERS_AUDIT } from './masters.config';
import {
  buildFormat,
  isSeriesKind,
  parseSeriesPatch,
  parseStandardFormat,
  parseStartNumber,
  SERIES_KINDS,
  SERIES_LIMITS,
  type SeriesKind,
  type SeriesParams,
} from './number-series.rules';
import {
  auditMaster,
  conflict,
  lockMasters,
  notFound,
  parsed,
  type MasterActor,
} from './masters-support';

export type SeriesView = {
  series: SeriesKind;
  configured: boolean;
  /** False when the stored format has another shape than the screen makes: it is shown, not edited. */
  editable: boolean;
  prefix: string;
  separator: string;
  fyStyle: 'SHORT' | 'LONG';
  width: number;
  resetRule: 'NEVER' | 'FINANCIAL_YEAR';
  fyStartMonth: number;
  /** A number of this series exists: the reset rule and the financial year start can no longer change. */
  locked: boolean;
  /** The last number of the current period (as text), 0 when none was issued in it yet. */
  lastNumber: string;
  /** What the next number will look like. */
  next: string;
};

/**
 * Number series of the hospital (Step 8c): the format of the BILL, RECEIPT and REFUND numbers.
 * A number once issued is never touched, so a change only affects NEW numbers. What decides the
 * counter period (the reset rule and the financial year start) is locked as soon as any number of
 * the series exists (the database enforces it too), a counter only moves forward (database trigger)
 * and a format change is checked so it cannot produce a number already issued. Money numbering, so
 * only a hospital-wide Admin may use this.
 */
@Injectable()
export class NumberSeriesAdminService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async assertHospitalWide(): Promise<void> {
    if ((await this.access.hospitalWideBranches('opd.settings.write', 'OPD')).length === 0) {
      throw opdError(403, OpdErrorCode.FORBIDDEN);
    }
  }

  private async timeZone(tx: TenantTx, tenantId: string): Promise<string> {
    const opd = await tx.opdSettings.findUnique({ where: { tenantId } });
    return opd?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
  }

  async list(actor: MasterActor): Promise<{ items: SeriesView[]; today: string }> {
    await this.assertHospitalWide();
    return this.tenantDb.withTenant(async (tx) => ({
      items: await Promise.all(SERIES_KINDS.map((kind) => this.viewInTx(tx, actor.tenantId, kind))),
      // the hospital's date today: the screen needs it to show the financial year in its preview
      today: localDate(this.clock.now(), await this.timeZone(tx, actor.tenantId)),
    }));
  }

  private async viewInTx(tx: TenantTx, tenantId: string, series: SeriesKind): Promise<SeriesView> {
    const now = this.clock.now();
    const settings = await tx.numberSeriesSettings.findUnique({
      where: { tenantId_series: { tenantId, series } },
    });
    const empty: SeriesView = {
      series,
      configured: false,
      editable: false,
      prefix: '',
      separator: '',
      fyStyle: 'SHORT',
      width: 5,
      resetRule: 'FINANCIAL_YEAR',
      fyStartMonth: 4,
      locked: false,
      lastNumber: '0',
      next: '',
    };
    if (!settings) {
      return empty;
    }
    const timeZone = await this.timeZone(tx, tenantId);
    const params = parseStandardFormat(settings.format);
    const periodYear = resolvePeriodYear(now, settings.resetRule, settings.fyStartMonth, timeZone);
    const counters = await tx.numberSeries.findMany({ where: { tenantId, series } });
    const current = counters.find((c) => c.periodYear === periodYear);
    const last = current?.lastNumber ?? BigInt(0);
    const financialYear = resolvePeriodYear(now, 'FINANCIAL_YEAR', settings.fyStartMonth, timeZone);
    return {
      ...empty,
      configured: true,
      editable: params !== null,
      ...(params ?? {}),
      resetRule: settings.resetRule,
      fyStartMonth: settings.fyStartMonth,
      locked: counters.length > 0,
      lastNumber: last.toString(),
      next: renderNumberSeriesFormat(settings.format as NumberSeriesFormat, {
        financialYear,
        running: last + BigInt(1),
      }),
    };
  }

  /** Does any of these numbers already exist as a bill, receipt or refund number of the hospital? */
  private async anyIssued(
    tx: TenantTx,
    tenantId: string,
    series: SeriesKind,
    numbers: string[],
  ): Promise<boolean> {
    if (series === 'BILL') {
      return (
        (await tx.bill.findFirst({
          where: { tenantId, billNumber: { in: numbers } },
          select: { id: true },
        })) !== null
      );
    }
    if (series === 'RECEIPT') {
      return (
        (await tx.receipt.findFirst({
          where: { tenantId, receiptNumber: { in: numbers } },
          select: { id: true },
        })) !== null
      );
    }
    return (
      (await tx.refundRequest.findFirst({
        where: { tenantId, refundNumber: { in: numbers } },
        select: { id: true },
      })) !== null
    );
  }

  /** The next `count` numbers a format would give from the current counter. */
  private lookAhead(
    format: NumberSeriesFormat,
    financialYear: number,
    last: bigint,
    count: number,
  ): string[] {
    return Array.from({ length: count }, (_, i) =>
      renderNumberSeriesFormat(format, { financialYear, running: last + BigInt(i + 1) }),
    );
  }

  async update(actor: MasterActor, seriesText: string, body: unknown): Promise<SeriesView> {
    await this.assertHospitalWide();
    if (!isSeriesKind(seriesText)) {
      return notFound();
    }
    const series: SeriesKind = seriesText;
    const patch = parsed(() => parseSeriesPatch(body));
    return this.tenantDb.withTenant(async (tx) => {
      const now = this.clock.now();
      await lockMasters(tx, actor.tenantId, now);
      const settings = await tx.numberSeriesSettings.findUnique({
        where: { tenantId_series: { tenantId: actor.tenantId, series } },
      });
      if (!settings) {
        return conflict('NOT_CONFIGURED');
      }
      const counters = await tx.numberSeries.findMany({
        where: { tenantId: actor.tenantId, series },
      });
      const locked = counters.length > 0;
      const current = parseStandardFormat(settings.format);
      const formatKeys = ['prefix', 'separator', 'fyStyle', 'width'] as const;
      const touchesFormat = formatKeys.some((k) => patch[k] !== undefined);
      if (touchesFormat && current === null) {
        return conflict('CUSTOM_FORMAT');
      }
      const changed: string[] = [];
      const next: SeriesParams = {
        ...(current ?? { prefix: '', separator: '', fyStyle: 'SHORT', width: 5 }),
      };
      for (const k of formatKeys) {
        if (patch[k] !== undefined && patch[k] !== next[k]) {
          (next as Record<string, unknown>)[k] = patch[k];
          changed.push(k);
        }
      }
      const nextReset = patch.resetRule ?? settings.resetRule;
      const nextMonth = patch.fyStartMonth ?? settings.fyStartMonth;
      if (nextReset !== settings.resetRule) changed.push('resetRule');
      if (nextMonth !== settings.fyStartMonth) changed.push('fyStartMonth');
      if (changed.length === 0) {
        return this.viewInTx(tx, actor.tenantId, series);
      }
      if (locked && (nextReset !== settings.resetRule || nextMonth !== settings.fyStartMonth)) {
        return conflict('LOCKED_AFTER_USE');
      }
      const format = buildFormat(next);
      if (locked && touchesFormat) {
        // The new format must not give a number that was already issued (a counter keeps counting).
        const timeZone = await this.timeZone(tx, actor.tenantId);
        const period = resolvePeriodYear(now, settings.resetRule, settings.fyStartMonth, timeZone);
        const last = counters.find((c) => c.periodYear === period)?.lastNumber ?? BigInt(0);
        const fy = resolvePeriodYear(now, 'FINANCIAL_YEAR', settings.fyStartMonth, timeZone);
        if (
          await this.anyIssued(
            tx,
            actor.tenantId,
            series,
            this.lookAhead(format, fy, last, SERIES_LIMITS.lookAhead),
          )
        ) {
          return conflict('NUMBER_EXISTS');
        }
      }
      await tx.numberSeriesSettings.update({
        where: { tenantId_series: { tenantId: actor.tenantId, series } },
        data: {
          ...(touchesFormat ? { format: format as unknown as object } : {}),
          resetRule: nextReset,
          fyStartMonth: nextMonth,
        },
      });
      await auditMaster(tx, actor, MASTERS_AUDIT.numberSeries, settings.id, {
        kind: 'UPDATE',
        series,
        changed,
      });
      return this.viewInTx(tx, actor.tenantId, series);
    });
  }

  /** Raise the counter of the current period so the NEXT number is `startNumber` (never lower it). */
  async setStartNumber(actor: MasterActor, seriesText: string, body: unknown): Promise<SeriesView> {
    await this.assertHospitalWide();
    if (!isSeriesKind(seriesText)) {
      return notFound();
    }
    const series: SeriesKind = seriesText;
    const input = parsed(() => parseStartNumber(body));
    return this.tenantDb.withTenant(async (tx) => {
      const now = this.clock.now();
      await lockMasters(tx, actor.tenantId, now);
      const settings = await tx.numberSeriesSettings.findUnique({
        where: { tenantId_series: { tenantId: actor.tenantId, series } },
      });
      if (!settings) {
        return conflict('NOT_CONFIGURED');
      }
      const timeZone = await this.timeZone(tx, actor.tenantId);
      const periodYear = resolvePeriodYear(
        now,
        settings.resetRule,
        settings.fyStartMonth,
        timeZone,
      );
      const target = BigInt(input.startNumber - 1);
      const row = await tx.numberSeries.findUnique({
        where: { tenantId_series_periodYear: { tenantId: actor.tenantId, series, periodYear } },
      });
      const last = row?.lastNumber ?? BigInt(0);
      if (target < last) {
        return conflict('NOT_RAISING');
      }
      if (target === last) {
        return this.viewInTx(tx, actor.tenantId, series);
      }
      const fy = resolvePeriodYear(now, 'FINANCIAL_YEAR', settings.fyStartMonth, timeZone);
      const candidates = this.lookAhead(settings.format as NumberSeriesFormat, fy, target, 1);
      if (await this.anyIssued(tx, actor.tenantId, series, candidates)) {
        return conflict('NUMBER_EXISTS');
      }
      if (row) {
        const moved = await tx.numberSeries.updateMany({
          where: {
            tenantId: actor.tenantId,
            series,
            periodYear,
            lastNumber: { lt: target },
          },
          data: { lastNumber: target },
        });
        if (moved.count !== 1) {
          return conflict('NOT_RAISING');
        }
      } else {
        await tx.numberSeries.create({
          data: { tenantId: actor.tenantId, series, periodYear, lastNumber: target },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: MASTERS_AUDIT.numberSeries.action,
          entityType: MASTERS_AUDIT.numberSeries.entityType,
          entityId: settings.id,
          reason: input.reason,
          metadata: {
            kind: 'START_NUMBER',
            series,
            periodYear,
            from: last.toString(),
            to: target.toString(),
          },
        },
      });
      return this.viewInTx(tx, actor.tenantId, series);
    });
  }
}
