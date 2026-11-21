import { render, screen, within } from '@testing-library/react';
import { CollectionReport } from '@/components/opd/collection-report';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { ReportQuery } from '@/lib/opd/reports';
import type { DailyCollectionReport, ReportFilterOptions } from '@/lib/opd/reports-types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const copy = staffCopy.opd.reports;

function row(key: string, name: string, collected: number, refunded: number, visits?: number) {
  return {
    key,
    name,
    payments: collected > 0 ? 1 : 0,
    refunds: refunded > 0 ? 1 : 0,
    collectedPaise: collected,
    refundedPaise: refunded,
    netPaise: collected - refunded,
    ...(visits === undefined ? {} : { visits }),
  };
}

function makeReport(overrides: Partial<DailyCollectionReport> = {}): DailyCollectionReport {
  return {
    date: '2026-11-20',
    timezone: 'Asia/Kolkata',
    branches: [{ id: 'b1', code: 'MAIN', name: 'Main Branch' }],
    combined: false,
    totals: {
      payments: 3,
      refunds: 1,
      collectedPaise: 150_000,
      refundedPaise: 50_000,
      netPaise: 100_000,
    },
    counts: { visits: 4, visitsCancelled: 1, bills: 5 },
    byMode: [row('CASH', 'Cash', 100_000, 50_000), row('UPI', 'UPI', 50_000, 0)],
    byDoctor: [row('DR1', 'Dr One', 150_000, 50_000, 4)],
    byBillType: [
      row('CONSULTATION', 'CONSULTATION', 100_000, 0),
      row('INVESTIGATION', 'INVESTIGATION', 50_000, 50_000),
    ],
    byDepartment: [row('General', 'General', 100_000, 0), row('(none)', '(none)', 50_000, 50_000)],
    byTest: [
      { key: 'CBC', name: 'Complete blood count', count: 2, billedPaise: 30_000 },
      { key: 'XR', name: 'Chest X-ray', count: 1, billedPaise: 20_000 },
    ],
    byBranch: [row('MAIN', 'Main Branch', 150_000, 50_000, 4)],
    ledger: { paymentPaise: 150_000, refundPaise: 50_000, matches: true },
    filters: {},
    ...overrides,
  };
}

const options: ReportFilterOptions = {
  branches: [{ id: 'b1', code: 'MAIN', name: 'Main Branch' }],
  activeBranchId: 'b1',
  canAllBranches: false,
  doctors: [{ code: 'DR1', name: 'Dr One' }],
  paymentModes: [
    { code: 'CASH', name: 'Cash' },
    { code: 'UPI', name: 'UPI' },
  ],
  departments: ['(none)', 'General'],
  billTypes: ['CONSULTATION', 'INVESTIGATION'],
  tests: [{ code: 'CBC', name: 'Complete blood count' }],
};
const query: ReportQuery = { date: '2026-11-20', branch: null, filters: {} };

function show(report = makeReport(), q: ReportQuery = query) {
  return render(
    <CollectionReport
      report={report}
      options={options}
      query={q}
      today="2026-11-20"
      weekStart={1}
    />,
  );
}

describe('CollectionReport', () => {
  it('shows collected, refunded and net as separate tiles from whole paise', () => {
    show();
    expect(
      within(screen.getByTestId('tile-collected')).getByText(formatPaise(150_000)),
    ).toBeTruthy();
    expect(within(screen.getByTestId('tile-refunded')).getByText(formatPaise(50_000))).toBeTruthy();
    expect(within(screen.getByTestId('tile-net')).getByText(formatPaise(100_000))).toBeTruthy();
    expect(within(screen.getByTestId('tile-visits')).getByText('4')).toBeTruthy();
    expect(screen.getByText(copy.visitsCancelled.replace('{count}', '1'))).toBeTruthy();
  });

  it('shows every table: payment mode, doctor, department, bill type and tests billed', () => {
    show();
    for (const title of [
      copy.byMode,
      copy.byDoctor,
      copy.byDepartment,
      copy.byBillType,
      copy.byTest,
    ]) {
      expect({ title, shown: screen.queryByRole('region', { name: title }) !== null }).toEqual({
        title,
        shown: true,
      });
    }
    const types = screen.getByRole('region', { name: copy.byBillType });
    expect(within(types).getByText(copy.billTypeConsultation)).toBeTruthy();
    expect(within(types).queryByText('CONSULTATION')).toBeNull();
    const departments = screen.getByRole('region', { name: copy.byDepartment });
    expect(within(departments).getByText(copy.noDepartment)).toBeTruthy();
    expect(within(departments).queryByText('(none)')).toBeNull();
    const tests = screen.getByRole('region', { name: copy.byTest });
    expect(within(tests).getByText('Complete blood count')).toBeTruthy();
    expect(within(tests).getByText(formatPaise(30_000))).toBeTruthy();
    expect(within(tests).getByText(copy.testsNote)).toBeTruthy();
  });

  it('has no tick boxes any more: the choices are the dropdowns of the toolbar', () => {
    show();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('group', { name: copy.filtersAria })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.printMenu })).toBeTruthy();
    expect(screen.queryByRole('link', { name: copy.menuCsv })).toBeNull();
  });

  it('shows the branch table only for a combined report', () => {
    const one = show();
    expect(screen.queryByRole('region', { name: copy.byBranch })).toBeNull();
    one.unmount();
    show(
      makeReport({
        combined: true,
        branches: [
          { id: 'b1', code: 'MAIN', name: 'Main Branch' },
          { id: 'b2', code: 'EAST', name: 'East Wing' },
        ],
      }),
    );
    expect(screen.getByRole('region', { name: copy.byBranch })).toBeTruthy();
    expect(screen.getByText(/Main Branch, East Wing/)).toBeTruthy();
  });

  it('says the ledger matches, warns loudly when it does not, and explains when it cannot be compared', () => {
    const ok = show();
    expect(screen.getByTestId('ledger-ok')).toBeTruthy();
    ok.unmount();
    const bad = show(makeReport({ ledger: { paymentPaise: 1, refundPaise: 0, matches: false } }));
    expect(screen.getByRole('alert').textContent).toBe(copy.ledgerBad);
    bad.unmount();
    show(
      makeReport({
        ledger: { paymentPaise: 1, refundPaise: 0, matches: null },
        filters: { doctor: 'DR1' },
      }),
      { ...query, filters: { doctor: 'DR1' } },
    );
    expect(screen.getByTestId('ledger-filtered').textContent).toBe(copy.ledgerFiltered);
    expect(screen.queryByTestId('ledger-ok')).toBeNull();
    expect(screen.queryByTestId('ledger-bad')).toBeNull();
  });

  it('says which choices are on, by their names, and explains a test filter', () => {
    show(makeReport(), {
      ...query,
      filters: { doctor: 'DR1', paymentMode: 'UPI', department: '(none)', test: 'CBC' },
    });
    expect(screen.getByTestId('showing-only').textContent).toBe(
      `Showing only: Dr One · UPI · ${copy.noDepartment} · Complete blood count`,
    );
    expect(screen.getByText(copy.testFilterNote)).toBeTruthy();
  });

  it('says nothing about choices when none is on', () => {
    show();
    expect(screen.queryByTestId('showing-only')).toBeNull();
    expect(screen.queryByText(copy.testFilterNote)).toBeNull();
  });

  it('shows a negative net with its minus sign', () => {
    show(
      makeReport({
        totals: {
          payments: 0,
          refunds: 1,
          collectedPaise: 0,
          refundedPaise: 20_000,
          netPaise: -20_000,
        },
      }),
    );
    expect(within(screen.getByTestId('tile-net')).getByText(formatPaise(-20_000))).toBeTruthy();
  });

  it('shows the empty state for a day (or a choice) with nothing', () => {
    show(
      makeReport({
        totals: { payments: 0, refunds: 0, collectedPaise: 0, refundedPaise: 0, netPaise: 0 },
        counts: { visits: 0, visitsCancelled: 0, bills: 0 },
        byMode: [],
        byDoctor: [],
        byBillType: [],
        byDepartment: [],
        byTest: [],
        byBranch: [],
      }),
    );
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId('tile-collected')).toBeNull();
    // the toolbar stays, so the choices can be changed
    expect(screen.getByRole('group', { name: copy.filtersAria })).toBeTruthy();
  });
});
