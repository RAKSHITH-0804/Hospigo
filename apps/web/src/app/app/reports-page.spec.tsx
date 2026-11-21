import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import CollectionReportPage from '@/app/app/opd/reports/page';
import { staffCopy } from '@/config/staff-copy';

const sessionMock = jest.fn();
const fetchMock = jest.fn();

jest.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});
jest.mock('@/lib/patients/server', () => ({
  ...jest.requireActual('@/lib/patients/server'),
  fetchStaffOnServer: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock('@/lib/auth/guards', () => ({
  requirePermission: async (code: string) => {
    const session = await sessionMock();
    if (!session.permissions?.includes(code)) {
      throw new Error('REDIRECT:/app?notice=no-permission');
    }
    return session;
  },
  redirectToRefresh: async () => {
    throw new Error('REDIRECT:/api/auth/refresh');
  },
}));

const copy = staffCopy.opd.reports;
const ok = (data: unknown) => ({ status: 'ok', data });

const options = {
  branches: [{ id: 'b1', code: 'MAIN', name: 'Main Branch' }],
  activeBranchId: 'b1',
  canAllBranches: false,
  doctors: [{ code: 'DR1', name: 'Dr Asha' }],
  paymentModes: [{ code: 'CASH', name: 'Cash' }],
  departments: ['General'],
  billTypes: ['CONSULTATION', 'INVESTIGATION'],
  tests: [],
};
const report = {
  date: '2026-11-20',
  timezone: 'Asia/Kolkata',
  branches: [{ id: 'b1', code: 'MAIN', name: 'Main Branch' }],
  combined: false,
  totals: { payments: 1, refunds: 0, collectedPaise: 60_000, refundedPaise: 0, netPaise: 60_000 },
  counts: { visits: 1, visitsCancelled: 0, bills: 1 },
  byMode: [],
  byDoctor: [],
  byBillType: [],
  byDepartment: [],
  byTest: [],
  byBranch: [],
  ledger: { paymentPaise: 60_000, refundPaise: 0, matches: true },
  filters: {},
};

function route(map: Record<string, unknown>) {
  fetchMock.mockImplementation(async (path: string) => map[path] ?? { status: 'notFound' });
}
const page = (params: Record<string, string | string[]> = {}) =>
  CollectionReportPage({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  sessionMock.mockReset();
  fetchMock.mockReset();
  sessionMock.mockResolvedValue({ id: 'u1', permissions: ['opd.reports.read'] });
});

describe('the collection report page', () => {
  it('needs opd.reports.read and reads nothing without it', async () => {
    sessionMock.mockResolvedValue({ id: 'u1', permissions: ['opd.billing.read'] });
    await expect(page()).rejects.toThrow('REDIRECT:/app?notice=no-permission');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the dropdown lists and the report for the day, branch and filters in the address', async () => {
    route({
      '/opd/reports/filters': ok(options),
      '/opd/reports/daily-collection': ok(report),
    });
    render(
      await page({
        date: '2026-11-18',
        branch: 'ALL',
        doctor: 'DR1',
        paymentMode: 'CASH',
        test: ['CBC', 'XR'],
        junk: 'x',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith('/opd/reports/filters');
    expect(fetchMock).toHaveBeenCalledWith('/opd/reports/daily-collection', {
      date: '2026-11-18',
      branch: 'ALL',
      doctor: 'DR1',
      paymentMode: 'CASH',
      test: 'CBC',
    });
    expect(screen.getByRole('group', { name: copy.filtersAria })).toBeTruthy();
    expect(screen.getByTestId('tile-collected')).toBeTruthy();
  });

  it('with an empty address it asks for the working branch, today, no filters', async () => {
    route({ '/opd/reports/filters': ok(options), '/opd/reports/daily-collection': ok(report) });
    render(await page());
    const call = fetchMock.mock.calls.find((c) => c[0] === '/opd/reports/daily-collection')!;
    expect(Object.keys(call[1])).toEqual(['date']);
    expect(call[1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a choice the API refuses (400) asks to clear the filters, with a button back to today', async () => {
    route({
      '/opd/reports/filters': ok(options),
      '/opd/reports/daily-collection': { status: 'invalid' },
    });
    render(await page({ doctor: 'nobody' }));
    expect(screen.getByRole('alert').textContent).toBe(copy.invalidQuery);
    expect(screen.getByRole('link', { name: copy.backToBranch }).getAttribute('href')).toMatch(
      /^\/app\/opd\/reports\?date=\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('a branch the person may not report on is explained, other failures are calm', async () => {
    route({
      '/opd/reports/filters': ok(options),
      '/opd/reports/daily-collection': { status: 'forbidden' },
    });
    const first = render(await page({ branch: 'ckother' }));
    expect(screen.getByRole('alert').textContent).toBe(copy.scopeForbidden);
    first.unmount();
    route({
      '/opd/reports/filters': { status: 'error', code: 'UNAVAILABLE' },
      '/opd/reports/daily-collection': ok(report),
    });
    render(await page());
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });
});
