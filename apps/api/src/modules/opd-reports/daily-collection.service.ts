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
import { parseSections, type ReportSection } from './report-sections';

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

/** Tests billed that day (a test line of an investigations bill), not money collected: a payment pays a whole bill. */
export type TestRow = { key: string; name: string; count: number; billedPaise: number };

/** The filters asked for (each one narrows the whole report; none means everything). */
export type ReportFilters = {
  doctor?: string;
  paymentMode?: string;
  department?: string;
  billType?: string;
  test?: string;
};

export type ReportFilterOptions = {
  /** The branches this person may report on, by name; the active one is `activeBranchId`. */
  branches: Array<{ id: string; code: string; name: string }>;
  activeBranchId: string;
  /** "All branches" is offered only with hospital-wide access to more than one branch. */
  canAllBranches: boolean;
  doctors: Array<{ code: string; name: string }>;
  paymentModes: Array<{ code: string; name: string }>;
  departments: string[];
  billTypes: string[];
  tests: Array<{ code: string; name: string }>;
};

export type DailyCollectionReport = {
  date: string;
  timezone: string;
  /** The branches this report covers (the active branch, one named branch, or all of them for hospital-wide access). */
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
  /** The doctor's department ("(none)" when the doctor has none). Same money as byDoctor, grouped differently. */
  byDepartment: CollectionRow[];
  /** Each test billed that day with how many times and the billed amount. */
  byTest: TestRow[];
  /** Only when more than one branch is covered. */
  byBranch: CollectionRow[];
  /**
   * The ledger (the book every payment and refund is also written to) added up for the same day
   * and branches. `matches` is false only if the two ever disagree, which would be a bug to report.
   * With a filter on doctor, payment mode, department, bill type or test it is `null`: the ledger
   * has no such split, so it cannot be compared.
   */
  ledger: { paymentPaise: number; refundPaise: number; matches: boolean | null };
  /** The filters that were applied (the ledger check only means something without them). */
  filters: ReportFilters;
};

type SumRow = { key: string; name: string; n: number; amt: bigint | number };
type Dimension = 'MODE' | 'DOCTOR' | 'DEPARTMENT' | 'BILL_TYPE' | 'BRANCH';

/** What a doctor without a department is called in the report (the screens show their own words). */
export const NO_DEPARTMENT_KEY = '(none)';
/** The same word as an SQL literal (a constant, not user input), so SELECT and GROUP BY hold the identical expression. */
const NO_DEPARTMENT_SQL = Prisma.raw(`'${NO_DEPARTMENT_KEY}'`);

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
    query: { date: string; branch?: string } & ReportFilters,
    format: 'VIEW' | 'EXPORT' = 'VIEW',
  ): Promise<DailyCollectionReport> {
    const combined = query.branch === C.allBranches;
    let branchIds: string[];
    if (combined) {
      branchIds = await this.access.hospitalWideBranches('opd.reports.read', 'OPD');
    } else if (query.branch && query.branch !== actor.branchId) {
      // Another named branch: only one the caller holds the report permission on.
      const permitted = await this.access.permittedBranches('opd.reports.read', 'OPD');
      branchIds = permitted.includes(query.branch) ? [query.branch] : [];
    } else {
      branchIds = [actor.branchId];
    }
    if (branchIds.length === 0) {
      throw opdError(403, OpdErrorCode.REPORT_SCOPE_FORBIDDEN);
    }
    return this.tenantDb.withTenant(async (tx) => {
      const settings = await tx.opdSettings.findUnique({ where: { tenantId: actor.tenantId } });
      const timezone = settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
      this.checkDate(query.date, timezone);

      const filters = await this.resolveFilters(tx, actor.tenantId, query);
      const report = await this.build(
        tx,
        actor.tenantId,
        query.date,
        timezone,
        branchIds,
        combined,
        filters,
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
          // Which filters were used (their names only, never what was picked)
          metadata: {
            date: query.date,
            combined,
            branches: branchIds.length,
            filtered: Object.keys(filters.asked),
          },
        },
      });
      return report;
    });
  }

  /** The lists for the dropdowns of the report screen: only this hospital's own values. */
  async filterOptions(actor: Actor): Promise<ReportFilterOptions> {
    const permitted = await this.access.permittedBranches('opd.reports.read', 'OPD');
    const wide = await this.access.hospitalWideBranches('opd.reports.read', 'OPD');
    return this.tenantDb.withTenant(async (tx) => {
      const [branches, doctors, modes, tests] = await Promise.all([
        tx.branch.findMany({
          where: { tenantId: actor.tenantId, id: { in: permitted } },
          select: { id: true, code: true, name: true },
          orderBy: { name: 'asc' },
        }),
        tx.doctorProfile.findMany({
          where: { tenantId: actor.tenantId },
          select: { code: true, department: true, user: { select: { displayName: true } } },
        }),
        tx.paymentMode.findMany({
          where: { tenantId: actor.tenantId },
          select: { code: true, name: true },
          orderBy: { name: 'asc' },
        }),
        tx.chargeItem.findMany({
          where: { tenantId: actor.tenantId, kind: 'INVESTIGATION' },
          select: { code: true, name: true },
          orderBy: { name: 'asc' },
          take: C.maxTestOptions,
        }),
      ]);
      const departments = new Set<string>();
      for (const d of doctors) {
        departments.add(d.department?.trim() ? d.department.trim() : NO_DEPARTMENT_KEY);
      }
      return {
        branches,
        activeBranchId: actor.branchId,
        canAllBranches: wide.length > 1,
        doctors: doctors
          .map((d) => ({ code: d.code, name: d.user.displayName }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
        paymentModes: modes,
        departments: [...departments].sort((a, b) => a.localeCompare(b)),
        billTypes: [...C.billTypes],
        tests,
      };
    });
  }

  /**
   * Checks the filters against this hospital's own data (an unknown doctor, mode, department, bill
   * type or test is `400 REPORT_FILTER_INVALID`, never an empty page that looks right) and returns
   * what the queries need. Values only ever reach the database as parameters.
   */
  private async resolveFilters(tx: TenantTx, tenantId: string, query: ReportFilters) {
    const asked: ReportFilters = {};
    const out: {
      asked: ReportFilters;
      doctorId?: string;
      modeId?: string;
      department?: string;
      billType?: string;
      test?: string;
    } = { asked };
    const refuse = (): never => {
      throw opdError(400, OpdErrorCode.REPORT_FILTER_INVALID);
    };
    if (query.doctor) {
      const doctor = await tx.doctorProfile.findFirst({
        where: { tenantId, code: query.doctor },
        select: { id: true },
      });
      if (!doctor) refuse();
      out.doctorId = doctor!.id;
      asked.doctor = query.doctor;
    }
    if (query.paymentMode) {
      const mode = await tx.paymentMode.findFirst({
        where: { tenantId, code: query.paymentMode },
        select: { id: true },
      });
      if (!mode) refuse();
      out.modeId = mode!.id;
      asked.paymentMode = query.paymentMode;
    }
    if (query.department) {
      const doctors = await tx.doctorProfile.findMany({
        where: { tenantId },
        select: { department: true },
      });
      const known = new Set(
        doctors.map((d) => (d.department?.trim() ? d.department.trim() : NO_DEPARTMENT_KEY)),
      );
      if (!known.has(query.department)) refuse();
      out.department = query.department;
      asked.department = query.department;
    }
    if (query.billType) {
      if (!(C.billTypes as readonly string[]).includes(query.billType)) refuse();
      out.billType = query.billType;
      asked.billType = query.billType;
    }
    if (query.test) {
      const test = await tx.chargeItem.findFirst({
        where: { tenantId, kind: 'INVESTIGATION', code: query.test },
        select: { code: true },
      });
      if (!test) refuse();
      out.test = test!.code;
      asked.test = query.test;
    }
    return out;
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
    filters: {
      asked: ReportFilters;
      doctorId?: string;
      modeId?: string;
      department?: string;
      billType?: string;
      test?: string;
    },
  ): Promise<DailyCollectionReport> {
    // The day as exact moments: midnight to midnight in the hospital's own time zone.
    const start = Prisma.sql`(${date}::date::timestamp AT TIME ZONE ${timezone})`;
    const end = Prisma.sql`((${date}::date + 1)::timestamp AT TIME ZONE ${timezone})`;
    const inBranches = (column: Prisma.Sql) => Prisma.sql`${column} IN (${Prisma.join(branchIds)})`;

    // The department of a doctor, as the report names it.
    const dept = Prisma.sql`coalesce(nullif(btrim(d.department), ''), ${NO_DEPARTMENT_SQL})`;
    // What each filter adds to a query that reads bills (b), visits (v) and doctors (d). Values are
    // parameters, never text in the SQL.
    const forDoctor = filters.doctorId ? Prisma.sql`AND d.id = ${filters.doctorId}` : Prisma.empty;
    const forDepartment = filters.department
      ? Prisma.sql`AND ${dept} = ${filters.department}`
      : Prisma.empty;
    const forBillType = filters.billType
      ? Prisma.sql`AND b.bill_type::text = ${filters.billType}`
      : Prisma.empty;
    const forTest = filters.test
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM bill_lines ft
                                WHERE ft.tenant_id = b.tenant_id AND ft.bill_id = b.id
                                  AND ft.kind::text = 'INVESTIGATION' AND ft.code_snapshot = ${filters.test})`
      : Prisma.empty;
    const forMode = filters.modeId
      ? Prisma.sql`AND x.payment_mode_id = ${filters.modeId}`
      : Prisma.empty;
    const filtered = Object.keys(filters.asked).length > 0;

    const sums = async (kind: 'PAYMENT' | 'REFUND', dim: Dimension): Promise<SumRow[]> => {
      const source = kind === 'PAYMENT' ? Prisma.sql`payments x` : Prisma.sql`refunds x`;
      const when = kind === 'PAYMENT' ? Prisma.sql`x.paid_at` : Prisma.sql`x.refunded_at`;
      const parts: Record<Dimension, { select: Prisma.Sql; group: Prisma.Sql; guard: Prisma.Sql }> =
        {
          MODE: {
            select: Prisma.sql`pm.code AS key, pm.name AS name`,
            group: Prisma.sql`pm.code, pm.name`,
            guard: Prisma.empty,
          },
          DOCTOR: {
            select: Prisma.sql`d.code AS key, u.display_name AS name`,
            group: Prisma.sql`d.code, u.display_name`,
            guard: Prisma.sql`AND d.id IS NOT NULL`,
          },
          DEPARTMENT: {
            select: Prisma.sql`${dept} AS key, ${dept} AS name`,
            group: dept,
            guard: Prisma.sql`AND d.id IS NOT NULL`,
          },
          BILL_TYPE: {
            select: Prisma.sql`b.bill_type::text AS key, b.bill_type::text AS name`,
            group: Prisma.sql`b.bill_type`,
            guard: Prisma.empty,
          },
          BRANCH: {
            select: Prisma.sql`br.code AS key, br.name AS name`,
            group: Prisma.sql`br.code, br.name`,
            guard: Prisma.empty,
          },
        };
      const p = parts[dim];
      return tx.$queryRaw<SumRow[]>(Prisma.sql`
        SELECT ${p.select}, count(*)::int AS n, coalesce(sum(x.amount_paise), 0)::bigint AS amt
          FROM ${source}
          JOIN payment_modes pm ON pm.tenant_id = x.tenant_id AND pm.id = x.payment_mode_id
          JOIN bills b ON b.tenant_id = x.tenant_id AND b.id = x.bill_id
          LEFT JOIN opd_visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
          LEFT JOIN doctor_profiles d ON d.tenant_id = v.tenant_id AND d.id = v.doctor_profile_id
          LEFT JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.user_id
          JOIN branches br ON br.tenant_id = x.tenant_id AND br.id = x.branch_id
         WHERE x.tenant_id = ${tenantId}
           AND ${inBranches(Prisma.sql`x.branch_id`)}
           AND ${when} >= ${start} AND ${when} < ${end}
           ${p.guard} ${forDoctor} ${forDepartment} ${forBillType} ${forTest} ${forMode}
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
         ${forDoctor} ${forDepartment}
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
      payDept,
      refDept,
      testRows,
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
        SELECT count(*)::int AS n
          FROM bills b
          LEFT JOIN opd_visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
          LEFT JOIN doctor_profiles d ON d.tenant_id = v.tenant_id AND d.id = v.doctor_profile_id
         WHERE b.tenant_id = ${tenantId} AND ${inBranches(Prisma.sql`b.branch_id`)}
           AND b.bill_date >= ${start} AND b.bill_date < ${end}
           ${forDoctor} ${forDepartment} ${forBillType} ${forTest}`),
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
      sums('PAYMENT', 'DEPARTMENT'),
      sums('REFUND', 'DEPARTMENT'),
      tx.$queryRaw<
        Array<{ key: string; name: string; n: number; amt: bigint | number }>
      >(Prisma.sql`
        SELECT bl.code_snapshot AS key, bl.description_snapshot AS name,
               coalesce(sum(bl.quantity), 0)::int AS n, coalesce(sum(bl.line_total_paise), 0)::bigint AS amt
          FROM bill_lines bl
          JOIN bills b ON b.tenant_id = bl.tenant_id AND b.id = bl.bill_id
          LEFT JOIN opd_visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
          LEFT JOIN doctor_profiles d ON d.tenant_id = v.tenant_id AND d.id = v.doctor_profile_id
         WHERE bl.tenant_id = ${tenantId} AND ${inBranches(Prisma.sql`b.branch_id`)}
           AND bl.kind::text = 'INVESTIGATION'
           AND b.bill_date >= ${start} AND b.bill_date < ${end}
           ${forDoctor} ${forDepartment} ${forBillType}
           ${filters.test ? Prisma.sql`AND bl.code_snapshot = ${filters.test}` : Prisma.empty}
         GROUP BY bl.code_snapshot, bl.description_snapshot`),
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
      matches: false as boolean | null,
    };
    // The ledger has no split by doctor, mode, department, bill type or test: with such a filter
    // there is nothing to compare (the day's books are still shown as they are).
    ledger.matches = filtered
      ? null
      : ledger.paymentPaise === collectedPaise && ledger.refundPaise === refundedPaise;

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
      byDepartment: merge(payDept, refDept),
      byTest: testRows
        .map((t) => ({ key: t.key, name: t.name, count: t.n, billedPaise: Number(t.amt) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
      byBranch: branchRows.length > 1 ? merge(payBranch, refBranch, visitsByBranch) : [],
      ledger,
      filters: filters.asked,
    };
  }

  /**
   * One flat table (Excel friendly): amounts in rupees, a section column says what each row is.
   * Only the chosen sections are written (the TOTAL row always is). Test rows are tests BILLED
   * that day, so they use their own two columns at the end instead of the money columns.
   */
  toCsv(
    report: DailyCollectionReport,
    sections: readonly ReportSection[] = parseSections(undefined),
  ): string {
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
      'tests_billed',
      'billed_rupees',
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
        '',
        '',
      ]);
    const testLine = (r: TestRow) =>
      csvRow([
        report.date,
        scope,
        'TEST',
        r.key,
        r.name,
        '',
        '',
        '',
        '',
        '',
        '',
        r.count,
        paiseToRupees(r.billedPaise),
      ]);
    const rows: Record<ReportSection, string[]> = {
      MODE: report.byMode.map((r) => line('MODE', r)),
      DOCTOR: report.byDoctor.map((r) => line('DOCTOR', r)),
      DEPARTMENT: report.byDepartment.map((r) => line('DEPARTMENT', r)),
      BILL_TYPE: report.byBillType.map((r) => line('BILL_TYPE', r)),
      TEST: report.byTest.map(testLine),
      BRANCH: report.byBranch.map((r) => line('BRANCH', r)),
    };
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
      ...sections.flatMap((section) => rows[section]),
    ];
    return `${C.csvBom}${lines.join('\r\n')}\r\n`;
  }
}
