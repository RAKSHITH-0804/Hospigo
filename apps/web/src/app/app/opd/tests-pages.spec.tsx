import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import TestsReceiptPage from '@/app/app/opd/visits/[id]/tests/[billId]/receipt/page';
import TestsToBillPage from '@/app/app/opd/tests/page';
import RefundRequestsPage from '@/app/app/opd/refunds/page';
import VisitTestsPage from '@/app/app/opd/visits/[id]/tests/page';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';

const sessionMock = jest.fn();
const fetchMock = jest.fn();

jest.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
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
  requireKind: async () => sessionMock(),
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

jest.mock('@/components/opd/tests-to-bill', () => ({
  TestsToBill: (props: Record<string, unknown>) => (
    <div data-testid="tests" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/opd/refund-requests-list', () => ({
  RefundRequestsList: (props: Record<string, unknown>) => (
    <div data-testid="refunds" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/opd/visit-tests-panel', () => ({
  VisitTestsPanel: (props: Record<string, unknown>) => (
    <div data-testid="visit-tests" data-props={JSON.stringify(props)} />
  ),
}));
jest.mock('@/components/opd/visit-receipt', () => ({
  VisitReceipt: (props: Record<string, unknown>) => (
    <div data-testid="receipt" data-props={JSON.stringify(props)} />
  ),
}));

const copy = staffCopy.opd.tests.reception;
const propsOf = (testId: string) =>
  JSON.parse(screen.getByTestId(testId).getAttribute('data-props') ?? '{}');
const session = (permissions: string[], hospitalName = 'Demo North') => ({
  kind: 'HOSPITAL',
  permissions,
  hospitalName,
});
const RECEPTION = ['opd.investigations.bill', 'opd.billing.collect', 'opd.billing.read'];
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });
const modes = {
  items: [{ code: 'CASH', name: 'Cash', requiresReference: false }],
  defaultCode: 'CASH',
  maxLines: 4,
};

beforeEach(() => {
  fetchMock.mockReset();
  sessionMock.mockReset();
});

describe('tests to bill page', () => {
  it('needs the permission to bill tests', async () => {
    sessionMock.mockResolvedValue(session(['opd.billing.collect']));
    await expect(TestsToBillPage()).rejects.toThrow('REDIRECT:/app?notice=no-permission');
  });

  it('billing also takes money: without the collect permission nothing is fetched', async () => {
    sessionMock.mockResolvedValue(session(['opd.investigations.bill']));
    render(await TestsToBillPage());
    expect(screen.getByText(copy.noPermissionTitle)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the pending tests and the payment modes together and passes the settings', async () => {
    sessionMock.mockResolvedValue(session(RECEPTION));
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/payment-modes' ? ok(modes) : ok({ items: [] }),
    );
    render(await TestsToBillPage());
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/opd/investigations/pending',
      '/opd/payment-modes',
    ]);
    expect(propsOf('tests')).toMatchObject({
      initial: { items: [] },
      paymentModes: { defaultCode: 'CASH', maxLines: 4 },
      refreshSeconds: opdWebConfig.pendingRefreshSeconds,
    });
  });

  it('failures and a hospital with no payment modes are shown in plain words', async () => {
    sessionMock.mockResolvedValue(session(RECEPTION));
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/payment-modes' ? ok(modes) : { status: 'error', code: 'UNAVAILABLE' },
    );
    const first = render(await TestsToBillPage());
    expect(screen.getByText(copy.loadErrorTitle)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    first.unmount();
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/payment-modes' ? { status: 'error', code: 'UNAVAILABLE' } : ok({ items: [] }),
    );
    const second = render(await TestsToBillPage());
    expect(screen.getByText(staffCopy.opd.newVisit.paymentModesErrorTitle)).toBeTruthy();
    second.unmount();
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/payment-modes'
        ? ok({ items: [], defaultCode: null, maxLines: 4 })
        : ok({ items: [] }),
    );
    render(await TestsToBillPage());
    expect(screen.getByText(staffCopy.opd.newVisit.noPaymentModes)).toBeTruthy();
  });
});

describe('tests receipt page', () => {
  const params = (id: string, billId: string) => ({ params: Promise.resolve({ id, billId }) });
  const visit = {
    id: 'v1',
    status: 'IN_CONSULTATION',
    token: { date: '2026-11-20', no: 3, label: 'T3' },
    bill: { id: 'consult-bill', billType: 'CONSULTATION' },
    patient: { id: 'p1', uhid: 'UH-1', name: 'Asha Rao' },
  };
  const testsBill = { id: 'bill-9', billType: 'INVESTIGATION', billNumber: 'B-9' };

  it('needs the billing read permission', async () => {
    sessionMock.mockResolvedValue(session(['opd.investigations.bill']));
    await expect(TestsReceiptPage(params('v1', 'bill-9'))).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('prints the INVESTIGATION bill of the visit (not the consultation bill) and no token', async () => {
    sessionMock.mockResolvedValue(session(RECEPTION, 'Demo North'));
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/visits/v1'
        ? ok(visit)
        : ok({ visitId: 'v1', visitStatus: 'IN_CONSULTATION', orders: [], bills: [testsBill] }),
    );
    render(await TestsReceiptPage(params('v1', 'bill-9')));
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/opd/visits/v1',
      '/opd/visits/v1/investigations',
    ]);
    const props = propsOf('receipt');
    expect(props.hospitalName).toBe('Demo North');
    expect(props.visit.bill).toEqual(testsBill);
    expect(props.visit.token).toBeNull();
    expect(props.visit.patient.name).toBe('Asha Rao');
  });

  it('a bill that is not on this visit, and a missing visit, are "not found"; failures are plain', async () => {
    sessionMock.mockResolvedValue(session(RECEPTION));
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/visits/v1'
        ? ok(visit)
        : ok({ visitId: 'v1', visitStatus: 'COMPLETED', orders: [], bills: [testsBill] }),
    );
    const other = render(await TestsReceiptPage(params('v1', 'someone-elses-bill')));
    expect(screen.getByText(staffCopy.opd.receipt.notFoundTitle)).toBeTruthy();
    other.unmount();
    fetchMock.mockResolvedValue({ status: 'notFound' });
    const missing = render(await TestsReceiptPage(params('v1', 'bill-9')));
    expect(screen.getByText(staffCopy.opd.receipt.notFoundTitle)).toBeTruthy();
    missing.unmount();
    fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
    render(await TestsReceiptPage(params('v1', 'bill-9')));
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('tests of one visit page', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const visit = { id: 'v1', patient: { id: 'p1', uhid: 'UH-1', name: 'Asha Rao' } };
  const tests = { visitId: 'v1', visitStatus: 'COMPLETED', orders: [], bills: [] };

  it('needs the permission to bill tests', async () => {
    sessionMock.mockResolvedValue(session(['opd.billing.read']));
    await expect(VisitTestsPage(params('v1'))).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('fetches the visit and its tests together; refund requests need their own permission', async () => {
    sessionMock.mockResolvedValue(session(RECEPTION));
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/visits/v1' ? ok(visit) : ok(tests),
    );
    const first = render(await VisitTestsPage(params('v1')));
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/opd/visits/v1',
      '/opd/visits/v1/investigations',
    ]);
    expect(propsOf('visit-tests')).toMatchObject({ canRequestRefund: false, tests });
    first.unmount();
    sessionMock.mockResolvedValue(session([...RECEPTION, 'opd.refunds.request']));
    render(await VisitTestsPage(params('v1')));
    expect(propsOf('visit-tests')).toMatchObject({ canRequestRefund: true });
  });

  it('not found and failures are shown in plain words', async () => {
    sessionMock.mockResolvedValue(session(RECEPTION));
    fetchMock.mockResolvedValue({ status: 'notFound' });
    const first = render(await VisitTestsPage(params('v1')));
    expect(screen.getByText(staffCopy.opd.receipt.notFoundTitle)).toBeTruthy();
    first.unmount();
    fetchMock.mockImplementation(async (path: string) =>
      path === '/opd/visits/v1' ? ok(visit) : { status: 'error', code: 'UNAVAILABLE' },
    );
    render(await VisitTestsPage(params('v1')));
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('refund requests page', () => {
  const ADMIN = ['opd.billing.read', 'opd.refunds.approve'];
  const list = { items: [], total: 0, page: 1, pageSize: opdWebConfig.refundsPageSize };
  const adminSession = (permissions = ADMIN) => ({ ...session(permissions), id: 'u-admin' });
  const search = (query: Record<string, string | string[] | undefined> = {}) => ({
    searchParams: Promise.resolve(query),
  });

  it('needs the billing read permission', async () => {
    sessionMock.mockResolvedValue(session(['opd.refunds.approve']));
    await expect(RefundRequestsPage(search())).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('an Admin starts on the open requests and gets the decision buttons', async () => {
    sessionMock.mockResolvedValue(adminSession());
    fetchMock.mockResolvedValue(ok(list));
    render(await RefundRequestsPage(search()));
    expect(fetchMock).toHaveBeenCalledWith('/opd/refund-requests', {
      status: 'REQUESTED',
      page: 1,
      pageSize: opdWebConfig.refundsPageSize,
    });
    expect(propsOf('refunds')).toMatchObject({
      filter: 'REQUESTED',
      canDecide: true,
      currentUserId: 'u-admin',
    });
  });

  it('reception starts on all requests, read-only', async () => {
    sessionMock.mockResolvedValue(adminSession(['opd.billing.read']));
    fetchMock.mockResolvedValue(ok(list));
    render(await RefundRequestsPage(search()));
    expect(fetchMock).toHaveBeenCalledWith('/opd/refund-requests', {
      page: 1,
      pageSize: opdWebConfig.refundsPageSize,
    });
    expect(propsOf('refunds')).toMatchObject({ filter: 'ALL', canDecide: false });
  });

  it('reads the filter and the page from the address; junk falls back to the defaults', async () => {
    sessionMock.mockResolvedValue(adminSession());
    fetchMock.mockResolvedValue(ok(list));
    const first = render(
      await RefundRequestsPage(
        search({ status: 'APPROVED', [opdWebConfig.refundsPageParam]: '3' }),
      ),
    );
    expect(fetchMock).toHaveBeenLastCalledWith('/opd/refund-requests', {
      status: 'APPROVED',
      page: 3,
      pageSize: opdWebConfig.refundsPageSize,
    });
    first.unmount();
    for (const junk of [
      { status: 'EVIL', [opdWebConfig.refundsPageParam]: '-4' },
      { status: ['A', 'B'], [opdWebConfig.refundsPageParam]: ['1', '2'] },
      { [opdWebConfig.refundsPageParam]: 'x' },
    ]) {
      const r = render(await RefundRequestsPage(search(junk)));
      expect(fetchMock).toHaveBeenLastCalledWith('/opd/refund-requests', {
        status: 'REQUESTED',
        page: 1,
        pageSize: opdWebConfig.refundsPageSize,
      });
      r.unmount();
    }
    // the ALL filter sends no status at all
    render(await RefundRequestsPage(search({ status: 'ALL' })));
    expect(fetchMock).toHaveBeenLastCalledWith('/opd/refund-requests', {
      page: 1,
      pageSize: opdWebConfig.refundsPageSize,
    });
  });

  it('a failure is shown in plain words', async () => {
    sessionMock.mockResolvedValue(adminSession());
    fetchMock.mockResolvedValue({ status: 'error', code: 'UNAVAILABLE' });
    render(await RefundRequestsPage(search()));
    expect(screen.getByText(staffCopy.opd.tests.refunds.loadErrorTitle)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
