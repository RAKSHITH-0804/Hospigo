import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RefundRequestsList } from '@/components/opd/refund-requests-list';
import { staffCopy } from '@/config/staff-copy';
import type { RefundListResponse, RefundRequestView } from '@/lib/opd/tests-types';

jest.mock('next/navigation', () => ({
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

const copy = staffCopy.opd.tests.refunds;

const request = (over: Partial<RefundRequestView> = {}): RefundRequestView => ({
  id: 'r1',
  type: 'REFUND',
  status: 'REQUESTED',
  amountPaise: 10000,
  reason: 'Wrong bill',
  bill: {
    id: 'bill-1',
    billNumber: 'B-26/00001',
    billType: 'CONSULTATION',
    totalPaise: 60000,
    paidPaise: 60000,
    refundedPaise: 0,
    refundablePaise: 60000,
  },
  visit: {
    id: 'v1',
    status: 'WAITING',
    token: 'T3',
    consultationStarted: false,
    patient: { id: 'p1', uhid: 'UH-1', name: 'Asha Rao' },
    doctor: { code: 'D2', name: 'Doctor North 2' },
  },
  requestedBy: { id: 'u-recv', name: 'Receptionist 1' },
  requestedAt: '2026-11-20T04:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  refundNumber: null,
  refunds: [],
  ...over,
});
const data = (...items: RefundRequestView[]): RefundListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
});
const hrefFor = (f: string, p: number) => `/app/opd/refunds?status=${f}&rp=${p}`;

function renderList(
  d: RefundListResponse,
  over: {
    filter?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ALL';
    canDecide?: boolean;
    user?: string | null;
  } = {},
) {
  return render(
    <RefundRequestsList
      data={d}
      filter={over.filter ?? 'REQUESTED'}
      hrefFor={hrefFor}
      canDecide={over.canDecide ?? true}
      currentUserId={over.user === undefined ? 'u-admin' : over.user}
    />,
  );
}

describe('refund requests list', () => {
  it('shows who asked what, for which bill and why, with Approve and Reject for an Admin', () => {
    renderList(data(request()));
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('UH-1 · T3')).toBeTruthy();
    expect(screen.getByText('B-26/00001')).toBeTruthy();
    expect(screen.getByText(copy.typeRefund)).toBeTruthy();
    expect(screen.getByText('₹100.00')).toBeTruthy();
    expect(screen.getByText('Can still be returned: ₹600.00')).toBeTruthy();
    expect(screen.getByText('Wrong bill')).toBeTruthy();
    expect(screen.getByText('Receptionist 1')).toBeTruthy();
    expect(screen.getAllByText(copy.statusRequested).length).toBeGreaterThan(1); // column header and badge
    expect(screen.getByRole('button', { name: 'Approve the request for ₹100.00' })).toBeTruthy();
    expect(screen.getByText(copy.descriptionDecide)).toBeTruthy();
  });

  it('reception sees the state read-only: no buttons', () => {
    renderList(data(request()), { canDecide: false, filter: 'ALL' });
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
    expect(screen.getByText(copy.descriptionRead)).toBeTruthy();
  });

  it('a request the signed-in Admin asked for has no buttons, with the reason', () => {
    renderList(data(request({ requestedBy: { id: 'u-admin', name: 'Me' } })));
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.getByText(copy.ownRequest)).toBeTruthy();
  });

  it('a request on a consultation that started is flagged and can only be rejected in practice', () => {
    renderList(
      data(
        request({
          visit: { ...request().visit, status: 'IN_CONSULTATION', consultationStarted: true },
        }),
      ),
    );
    expect(screen.getByText(copy.consultationStarted)).toBeTruthy();
  });

  it('an investigations bill after the consultation started is NOT flagged (it can still be refunded)', () => {
    renderList(
      data(
        request({
          bill: { ...request().bill, billType: 'INVESTIGATION' },
          visit: { ...request().visit, consultationStarted: true },
        }),
      ),
    );
    expect(screen.queryByText(copy.consultationStarted)).toBeNull();
  });

  it('a decided request shows who decided, the voucher, each mode returned and the note; no buttons', () => {
    renderList(
      data(
        request({
          status: 'APPROVED',
          type: 'CANCEL_VISIT',
          decidedBy: { id: 'u-admin2', name: 'Admin Two' },
          decidedAt: '2026-11-20T06:00:00.000Z',
          decisionNote: 'Verified at the desk',
          refundNumber: 'RF-26/00001',
          refunds: [
            {
              paymentMode: { code: 'CASH', name: 'Cash' },
              amountPaise: 30000,
              referenceNo: null,
              refundedAt: '2026-11-20T06:00:00.000Z',
            },
            {
              paymentMode: { code: 'UPI', name: 'UPI' },
              amountPaise: 20000,
              referenceNo: 'R1',
              refundedAt: '2026-11-20T06:00:01.000Z',
            },
          ],
        }),
      ),
      { filter: 'APPROVED' },
    );
    expect(screen.getAllByText(copy.statusApproved).length).toBeGreaterThan(1); // filter link and badge
    expect(screen.getByText(copy.typeCancel)).toBeTruthy();
    expect(screen.getByText(/Admin Two/)).toBeTruthy();
    expect(screen.getByText('Voucher RF-26/00001')).toBeTruthy();
    expect(screen.getByText('Returned Cash: ₹300.00')).toBeTruthy();
    expect(screen.getByText('Returned UPI: ₹200.00')).toBeTruthy();
    expect(screen.getByText('Note: Verified at the desk')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('filters are links and the chosen one is marked; an empty list says so', () => {
    renderList(data(), { filter: 'APPROVED' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      copy.tabOpen,
      copy.tabApproved,
      copy.tabRejected,
      copy.tabAll,
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/app/opd/refunds?status=REQUESTED&rp=1',
      '/app/opd/refunds?status=APPROVED&rp=1',
      '/app/opd/refunds?status=REJECTED&rp=1',
      '/app/opd/refunds?status=ALL&rp=1',
    ]);
    expect(links[1]!.getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy();
  });

  it('pages with plain previous and next links that keep the filter', () => {
    renderList({ items: [request()], total: 45, page: 2, pageSize: 20 }, { filter: 'REJECTED' });
    expect(
      screen.getByRole('link', { name: staffCopy.opd.tabs.previous }).getAttribute('href'),
    ).toBe('/app/opd/refunds?status=REJECTED&rp=1');
    expect(screen.getByRole('link', { name: staffCopy.opd.tabs.next }).getAttribute('href')).toBe(
      '/app/opd/refunds?status=REJECTED&rp=3',
    );
  });
});
