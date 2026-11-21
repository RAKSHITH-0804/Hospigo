import { EmptyState } from '@/components/states/empty-state';
import { ReportActions, ReportToolbar } from '@/components/opd/report-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import type { ReportQuery } from '@/lib/opd/reports';
import type {
  CollectionRow,
  DailyCollectionReport,
  ReportFilterOptions,
} from '@/lib/opd/reports-types';

const copy = staffCopy.opd.reports;

function billTypeName(row: CollectionRow): string {
  switch (row.key) {
    case 'CONSULTATION':
      return copy.billTypeConsultation;
    case 'INVESTIGATION':
      return copy.billTypeInvestigation;
    default:
      return row.name;
  }
}

const NO_DEPARTMENT_KEY = '(none)';

function departmentName(row: CollectionRow): string {
  return row.key === NO_DEPARTMENT_KEY ? copy.noDepartment : row.name;
}

function TestsTable({ rows }: { rows: DailyCollectionReport['byTest'] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="report-section" aria-label={copy.byTest}>
      <h2 className="type-heading font-semibold">{copy.byTest}</h2>
      <p className="type-small text-muted-foreground">{copy.testsNote}</p>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">{copy.colTest}</th>
              <th scope="col">{copy.colTestCount}</th>
              <th scope="col" className="report-amount">
                {copy.colTestAmount}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.key}-${row.name}`}>
                <th scope="row">{row.name}</th>
                <td>{row.count}</td>
                <td className="report-amount">{formatPaise(row.billedPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowsTable({
  title,
  rows,
  showVisits,
  nameOf,
}: {
  title: string;
  rows: CollectionRow[];
  showVisits?: boolean;
  nameOf?: (row: CollectionRow) => string;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="report-section" aria-label={title}>
      <h2 className="type-heading font-semibold">{title}</h2>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">{copy.colName}</th>
              {showVisits ? <th scope="col">{copy.colVisits}</th> : null}
              <th scope="col">{copy.colPayments}</th>
              <th scope="col">{copy.colRefunds}</th>
              <th scope="col" className="report-amount">
                {copy.colCollected}
              </th>
              <th scope="col" className="report-amount">
                {copy.colRefunded}
              </th>
              <th scope="col" className="report-amount">
                {copy.colNet}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{nameOf ? nameOf(row) : row.name}</th>
                {showVisits ? <td>{row.visits ?? 0}</td> : null}
                <td>{row.payments}</td>
                <td>{row.refunds}</td>
                <td className="report-amount">{formatPaise(row.collectedPaise)}</td>
                <td className="report-amount">{formatPaise(row.refundedPaise)}</td>
                <td className="report-amount font-semibold">{formatPaise(row.netPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tile({
  testId,
  label,
  value,
  note,
}: {
  testId: string;
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="report-tile" data-testid={testId}>
      <span className="type-label text-muted-foreground">{label}</span>
      <span className="report-tile-value">{value}</span>
      <span className="type-small text-muted-foreground">{note}</span>
    </div>
  );
}

/**
 * The daily collection report (server component; the page fetches it, the toolbar above it is the
 * only client part). Money is shown from whole paise; refunds have their own column and tile and
 * are never mixed into "collected". With a filter on, every table shows only what matches it.
 */
export function CollectionReport({
  report,
  options,
  query,
  today,
  weekStart,
}: {
  report: DailyCollectionReport;
  options: ReportFilterOptions;
  query: ReportQuery;
  today: string;
  weekStart: number;
}) {
  const { totals, counts } = report;
  const empty = totals.payments === 0 && totals.refunds === 0 && counts.visits === 0;
  const branchNames = report.branches.map((b) => b.name).join(', ');
  const choices = chosenLabels(query, options);

  return (
    <div className="section-stack content-container-inner report-root">
      <div className="no-print">
        <PageHeader
          title={copy.title}
          description={copy.description}
          actions={<ReportActions query={query} />}
        />
      </div>

      <ReportToolbar query={query} options={options} today={today} weekStart={weekStart} />

      <p className="report-print-title type-heading font-semibold">
        {fill(copy.printedFor, { date: report.date })}
      </p>
      <p className="type-label text-muted-foreground">
        {fill(copy.covers, { branches: branchNames })} ·{' '}
        {fill(copy.timezone, { timezone: report.timezone })}
      </p>
      {choices.length > 0 ? (
        <p className="type-label-strong" data-testid="showing-only">
          {fill(copy.showing, { choices: choices.join(' · ') })}
        </p>
      ) : null}
      {query.filters.test ? (
        <p className="type-small text-muted-foreground">{copy.testFilterNote}</p>
      ) : null}

      {empty ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
      ) : (
        <>
          <div className="report-tiles">
            <Tile
              testId="tile-collected"
              label={copy.collected}
              value={formatPaise(totals.collectedPaise)}
              note={fill(copy.payments, { count: totals.payments })}
            />
            <Tile
              testId="tile-refunded"
              label={copy.refunded}
              value={formatPaise(totals.refundedPaise)}
              note={fill(copy.refundsCount, { count: totals.refunds })}
            />
            <Tile
              testId="tile-net"
              label={copy.net}
              value={formatPaise(totals.netPaise)}
              note={fill(copy.bills, { count: counts.bills })}
            />
            <Tile
              testId="tile-visits"
              label={copy.visits}
              value={counts.visits}
              note={fill(copy.visitsCancelled, { count: counts.visitsCancelled })}
            />
          </div>

          {report.ledger.matches === null ? (
            <p className="type-label text-muted-foreground" data-testid="ledger-filtered">
              {copy.ledgerFiltered}
            </p>
          ) : report.ledger.matches ? (
            <p className="type-label text-muted-foreground" data-testid="ledger-ok">
              {copy.ledgerOk}
            </p>
          ) : (
            <p role="alert" className="type-label text-destructive" data-testid="ledger-bad">
              {copy.ledgerBad}
            </p>
          )}

          <div className="report-sections">
            <RowsTable title={copy.byMode} rows={report.byMode} />
            <RowsTable title={copy.byDoctor} rows={report.byDoctor} showVisits />
            <RowsTable
              title={copy.byDepartment}
              rows={report.byDepartment}
              nameOf={departmentName}
            />
            <RowsTable title={copy.byBillType} rows={report.byBillType} nameOf={billTypeName} />
            {report.combined ? (
              <RowsTable title={copy.byBranch} rows={report.byBranch} showVisits />
            ) : null}
            <TestsTable rows={report.byTest} />
          </div>
        </>
      )}
    </div>
  );
}

/** The words of the filters that are on ("Doctor North 2", "UPI"), for the line under the toolbar. */
function chosenLabels(query: ReportQuery, options: ReportFilterOptions): string[] {
  const out: string[] = [];
  const f = query.filters;
  if (f.doctor) {
    out.push(options.doctors.find((d) => d.code === f.doctor)?.name ?? f.doctor);
  }
  if (f.paymentMode) {
    out.push(options.paymentModes.find((m) => m.code === f.paymentMode)?.name ?? f.paymentMode);
  }
  if (f.department) {
    out.push(f.department === NO_DEPARTMENT_KEY ? copy.noDepartment : f.department);
  }
  if (f.billType) {
    out.push(
      f.billType === 'CONSULTATION' ? copy.billTypeConsultation : copy.billTypeInvestigation,
    );
  }
  if (f.test) {
    out.push(options.tests.find((t) => t.code === f.test)?.name ?? f.test);
  }
  return out;
}
