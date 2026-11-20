import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { localDate, type Actor } from '../opd-visits/opd-visits.service';
import { csvRow, paiseToRupees } from './csv.util';
import { OPD_REPORTS_CONFIG as C, OPD_REPORT_AUDIT } from './opd-reports.config';

export type CollectionRow = {
  key: string;
  name: string;
  payments: number;
  refunds: number;
  collectedPaise: number;
  refundedPaise: number;
  netPaise: number;
  /** Visits of the day (only on the doctor and branch rows). */
  visits?: number;
};

export type DailyCollectionReport = {
  date: string;
  timezone: string;
  /** The branches this report covers (the active branch, or all of them for hospital-wide access). */
  branches: Array<{ id: string; code: string; name: string }>;
  combined: boolean;
  totals: {
    payments: number;
    refunds: number;
    collectedPaise: number;
    refundedPaise: number;
    netPaise: number;
  };
  counts: { visits: number; visitsCancelled: number; bills: number };
  byMode: CollectionRow[];
  byDoctor: CollectionRow[];
  byBillType: CollectionRow[];
  /** Only when more than one branch is covered. */
  byBranch: CollectionRow[];
  /**
   * The ledger (the book every payment and refund is also written to) added up for the same day
   * and branches. `matches` is false only if the two ever disagree, which would be a bug to report.
   */
  ledger: { paymentPaise: number; refundPaise: number; matches: boolean };
};

type SumRow = { key: string; name: string; n: number; amt: bigint | number };
type Dimension = 'MODE' | 'DOCTOR' | 'BILL_TYPE' | 'BRANCH';

function isRealDate(text: string): boolean {
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

/**
 * Step 7-1: the daily collection report (UC-13). One day of the hospital's time zone, for the
 * active branch or (with hospital-wide access) for all branches: money collected by payment mode,
 * by doctor and by bill type, refunds shown SEPARATELY, and the net. A payment counts on the day it
 * was paid, a refund on the day it was approved and written, never on the day of the bill.
 *
 * The report only READS. Every amount is whole paise taken straight from the payments and refunds
 * tables, and it is checked against the ledger for the same day. The hospital always comes from
 * the token and the database applies row level security as well.
 */
@Injectable()
export class DailyCollectionService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async report(
    actor: Actor,
    query: { date: string; branch?: string },
    format: 'VIEW' | 'EXPORT' = 'VIEW',
  ): Promise<DailyCollectionReport> {
    const combined = query.branch === C.allBranches;
    const branchIds = combined
      ? await this.access.hospitalWideBranches('opd.reports.read', 'OPD')
      : [actor.branchId];
    if (branchIds.length === 0) {
      throw opdError(403, OpdErrorCode.REPORT_SCOPE_FORBIDDEN);
    }
    return this.tenantDb.withTenant(async (tx) => {
      const settings = await tx.opdSettings.findUnique({ where: { tenantId: actor.tenantId } });
      const timezone = settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
      this.checkDate(query.date, timezone);

      const report = await this.build(
        tx,
        actor.tenantId,
        query.date,
        timezone,
        branchIds,
        combined,
      );
      // Looking at the money of the hospital is itself recorded (who, which day, which scope).
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          branchId: actor.branchId,
          action: format === 'EXPORT' ? OPD_REPORT_AUDIT.exported : OPD_REPORT_AUDIT.viewed,
          entityType: 'opd_report',
          entityId: query.date,
          metadata: { date: query.date, combined, branches: branchIds.length },
        },
      });
      return report;
    });
  }

  private checkDate(date: string, timezone: string): void {
    if (!isRealDate(date) || date < C.earliestDate) {
      throw opdError(400, OpdErrorCode.REPORT_DATE_INVALID);
    }
    // Not a day that has not started yet in the hospital's own time zone.
    const today = localDate(this.clock.now(), timezone).toISOString().slice(0, 10);
    if (date > today) {
      throw opdError(400, OpdErrorCode.REPORT_DATE_INVALID);
    }
  }

  private async build(
    tx: TenantTx,
    tenantId: string,
    date: string,
    timezone: string,
    branchIds: string[],
    combined: boolean,
  ): Promise<DailyCollectionReport> {
    // The day as exact moments: midnight to midnight in the hospital's own time zone.
    const start = Prisma.sql`(${date}::date::timestamp AT TIME ZONE ${timezone})`;
    const end = Prisma.sql`((${date}::date + 1)::timestamp AT TIME ZONE ${timezone})`;
    const inBranches = (column: Prisma.Sql) => Prisma.sql`${column} IN (${Prisma.join(branchIds)})`;

    const sums = async (kind: 'PAYMENT' | 'REFUND', dim: Dimension): Promise<SumRow[]> => {
      const source = kind === 'PAYMENT' ? Prisma.sql`payments x` : Prisma.sql`refunds x`;
      const when = kind === 'PAYMENT' ? Prisma.sql`x.paid_at` : Prisma.sql`x.refunded_at`;
      const billJoin = Prisma.sql`JOIN bills b ON b.tenant_id = x.tenant_id AND b.id = x.bill_id`;
      const parts: Record<Dimension, { select: Prisma.Sql; joins: Prisma.Sql; group: Prisma.Sql }> =
        {
          MODE: {
            select: Prisma.sql`pm.code AS key, pm.name AS name`,
            joins: Prisma.sql`JOIN payment_modes pm ON pm.tenant_id = x.tenant_id AND pm.id = x.payment_mode_id`,
            group: Prisma.sql`pm.code, pm.name`,
          },
          DOCTOR: {
            select: Prisma.sql`d.code AS key, u.display_name AS name`,
            joins: Prisma.sql`${billJoin}
            JOIN opd_visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
            JOIN doctor_profiles d ON d.tenant_id = v.tenant_id AND d.id = v.doctor_profile_id
            JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.user_id`,
            group: Prisma.sql`d.code, u.display_name`,
          },
          BILL_TYPE: {
            select: Prisma.sql`b.bill_type::text AS key, b.bill_type::text AS name`,
            joins: billJoin,
            group: Prisma.sql`b.bill_type`,
          },
          BRANCH: {
            select: Prisma.sql`br.code AS key, br.name AS name`,
            joins: Prisma.sql`JOIN branches br ON br.tenant_id = x.tenant_id AND br.id = x.branch_id`,
            group: Prisma.sql`br.code, br.name`,
          },
        };
      const p = parts[dim];
      return tx.$queryRaw<SumRow[]>(Prisma.sql`
        SELECT ${p.select}, count(*)::int AS n, coalesce(sum(x.amount_paise), 0)::bigint AS amt
          FROM ${source}
          ${p.joins}
         WHERE x.tenant_id = ${tenantId}
           AND ${inBranches(Prisma.sql`x.branch_id`)}
           AND ${when} >= ${start} AND ${when} < ${end}
         GROUP BY ${p.group}`);
    };

    const merge = (
      paid: SumRow[],
      back: SumRow[],
      visits?: Map<string, number>,
    ): CollectionRow[] => {
      const rows = new Map<string, CollectionRow>();
      const row = (r: SumRow): CollectionRow => {
        let out = rows.get(r.key);
        if (!out) {
          out = {
            key: r.key,
            name: r.name,
            payments: 0,
            refunds: 0,
            collectedPaise: 0,
            refundedPaise: 0,
            netPaise: 0,
          };
          rows.set(r.key, out);
        }
        return out;
      };
      for (const r of paid) {
        const out = row(r);
        out.payments += r.n;
        out.collectedPaise += Number(r.amt);
      }
      for (const r of back) {
        const out = row(r);
        out.refunds += r.n;
        out.refundedPaise += Number(r.amt);
      }
      for (const out of rows.values()) {
        out.netPaise = out.collectedPaise - out.refundedPaise;
        if (visits) {
          out.visits = visits.get(out.key) ?? 0;
        }
      }
      // A doctor or branch with visits but no money that day still has a row.
      if (visits) {
        for (const [key, n] of visits) {
          if (!rows.has(key)) {
            rows.set(key, {
              key,
              name: key,
              payments: 0,
              refunds: 0,
              collectedPaise: 0,
              refundedPaise: 0,
              netPaise: 0,
              visits: n,
            });
          }
        }
      }
      return [...rows.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
      );
    };

    const visitRows = await tx.$queryRaw<
      Array<{
        doctor_code: string;
        doctor_name: string;
        branch_code: string;
        total: number;
        cancelled: number;
      }>
    >(Prisma.sql`
      SELECT d.code AS doctor_code, u.display_name AS doctor_name, br.code AS branch_code,
             count(*)::int AS total,
             (count(*) FILTER (WHERE v.status = 'CANCELLED'))::int AS cancelled
        FROM opd_visits v
        JOIN doctor_profiles d ON d.tenant_id = v.tenant_id AND d.id = v.doctor_profile_id
        JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.user_id
        JOIN branches br ON br.tenant_id = v.tenant_id AND br.id = v.branch_id
       WHERE v.tenant_id = ${tenantId}
         AND ${inBranches(Prisma.sql`v.branch_id`)}
         AND v.visit_date = ${date}::date
       GROUP BY d.code, u.display_name, br.code`);
    const visitsByDoctor = new Map<string, number>();
    const doctorNames = new Map<string, string>();
    const visitsByBranch = new Map<string, number>();
    let visits = 0;
    let visitsCancelled = 0;
    for (const v of visitRows) {
      visitsByDoctor.set(v.doctor_code, (visitsByDoctor.get(v.doctor_code) ?? 0) + v.total);
      doctorNames.set(v.doctor_code, v.doctor_name);
      visitsByBranch.set(v.branch_code, (visitsByBranch.get(v.branch_code) ?? 0) + v.total);
      visits += v.total;
      visitsCancelled += v.cancelled;
    }

    const [
      payMode,
      refMode,
      payDoctor,
      refDoctor,
      payType,
      refType,
      payBranch,
      refBranch,
      billCount,
      ledgerRows,
      branchRows,
    ] = await Promise.all([
      sums('PAYMENT', 'MODE'),
      sums('REFUND', 'MODE'),
      sums('PAYMENT', 'DOCTOR'),
      sums('REFUND', 'DOCTOR'),
      sums('PAYMENT', 'BILL_TYPE'),
      sums('REFUND', 'BILL_TYPE'),
      sums('PAYMENT', 'BRANCH'),
      sums('REFUND', 'BRANCH'),
      tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int AS n FROM bills
         WHERE tenant_id = ${tenantId} AND ${inBranches(Prisma.sql`branch_id`)}
           AND bill_date >= ${start} AND bill_date < ${end}`),
      tx.$queryRaw<Array<{ kind: string; amt: bigint | number }>>(Prisma.sql`
        SELECT entry_type::text AS kind, coalesce(sum(amount_paise), 0)::bigint AS amt
          FROM ledger_entries
         WHERE tenant_id = ${tenantId} AND ${inBranches(Prisma.sql`branch_id`)}
           AND entry_type IN ('PAYMENT', 'REFUND')
           AND posted_at >= ${start} AND posted_at < ${end}
         GROUP BY entry_type`),
      tx.branch.findMany({
        where: { tenantId, id: { in: branchIds } },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Doctors with visits but no money that day take their name from the visit rows.
    const byDoctor = merge(payDoctor, refDoctor, visitsByDoctor).map((r) => ({
      ...r,
      name: r.name === r.key ? (doctorNames.get(r.key) ?? r.key) : r.name,
    }));
    const byMode = merge(payMode, refMode);
    const sumOf = (
      rows: CollectionRow[],
      field: 'collectedPaise' | 'refundedPaise' | 'payments' | 'refunds',
    ) => rows.reduce((s, r) => s + r[field], 0);
    const collectedPaise = sumOf(byMode, 'collectedPaise');
    const refundedPaise = sumOf(byMode, 'refundedPaise');
    const ledgerOf = (kind: string) => Number(ledgerRows.find((l) => l.kind === kind)?.amt ?? 0);
    const ledger = {
      paymentPaise: ledgerOf('PAYMENT'),
      refundPaise: ledgerOf('REFUND'),
      matches: false,
    };
    ledger.matches = ledger.paymentPaise === collectedPaise && ledger.refundPaise === refundedPaise;

    return {
      date,
      timezone,
      branches: branchRows,
      combined,
      totals: {
        payments: sumOf(byMode, 'payments'),
        refunds: sumOf(byMode, 'refunds'),
        collectedPaise,
        refundedPaise,
        netPaise: collectedPaise - refundedPaise,
      },
      counts: { visits, visitsCancelled, bills: billCount[0]?.n ?? 0 },
      byMode,
      byDoctor,
      byBillType: merge(payType, refType),
      byBranch: branchRows.length > 1 ? merge(payBranch, refBranch, visitsByBranch) : [],
      ledger,
    };
  }

  /** One flat table (Excel friendly): amounts in rupees, a section column says what each row is. */
  toCsv(report: DailyCollectionReport): string {
    const scope = report.branches.map((b) => b.code).join(' ');
    const head = [
      'date',
      'branches',
      'section',
      'key',
      'name',
      'payments',
      'refunds',
      'collected_rupees',
      'refunded_rupees',
      'net_rupees',
      'visits',
    ];
    const line = (
      section: string,
      r: Pick<
        CollectionRow,
        'key' | 'name' | 'payments' | 'refunds' | 'collectedPaise' | 'refundedPaise' | 'netPaise'
      > & {
        visits?: number;
      },
    ) =>
      csvRow([
        report.date,
        scope,
        section,
        r.key,
        r.name,
        r.payments,
        r.refunds,
        paiseToRupees(r.collectedPaise),
        paiseToRupees(r.refundedPaise),
        paiseToRupees(r.netPaise),
        r.visits ?? '',
      ]);
    const lines = [
      csvRow(head),
      line('TOTAL', {
        key: 'total',
        name: 'Total',
        payments: report.totals.payments,
        refunds: report.totals.refunds,
        collectedPaise: report.totals.collectedPaise,
        refundedPaise: report.totals.refundedPaise,
        netPaise: report.totals.netPaise,
        visits: report.counts.visits,
      }),
      ...report.byMode.map((r) => line('MODE', r)),
      ...report.byDoctor.map((r) => line('DOCTOR', r)),
      ...report.byBillType.map((r) => line('BILL_TYPE', r)),
      ...report.byBranch.map((r) => line('BRANCH', r)),
    ];
    return `${C.csvBom}${lines.join('\r\n')}\r\n`;
  }
}
