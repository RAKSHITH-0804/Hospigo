import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BillsPanel, VisitsPanel } from '@/components/opd/visit-lists';
import { VisitTestsPanel } from '@/components/opd/visit-tests-panel';
import { staffCopy } from '@/config/staff-copy';
import type { OrderView, VisitTestsResponse } from '@/lib/opd/tests-types';
import type { BillView, VisitsTabData, VisitView } from '@/lib/opd/types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const copy = staffCopy.opd.tests;

const bill = (over: Partial<BillView> = {}): BillView => ({
  id: 'bill-1',
  billNumber: 'B-26/00001',
  billType: 'CONSULTATION',
  billDate: '2026-11-20T04:00:00.000Z',
  subtotalPaise: 60000,
  taxPaise: 0,
  totalPaise: 60000,
  paidPaise: 60000,
  refundedPaise: 0,
  paymentStatus: 'PAID',
  ...over,
});
const visit = (over: Partial<VisitView> = {}): VisitView => ({
  id: 'visit-1',
  status: 'WAITING',
  visitType: 'NEW',
  visitDate: '2026-11-20',
  branch: { id: 'b1', name: 'North Main' },
  patient: { id: 'p1', uhid: 'UH-1', name: 'Asha Rao' },
  doctor: { id: 'd1', code: 'D2', name: 'Doctor North 2' },
  previousVisitId: null,
  token: { date: '2026-11-20', no: 3, label: 'T3' },
  queuedAt: '2026-11-20T04:00:00.000Z',
  createdAt: '2026-11-20T04:00:00.000Z',
  bill: bill(),
  ...over,
});
const tab = (...items: VisitView[]): VisitsTabData => ({
  status: 'ok',
  data: { items, total: items.length, page: 1, pageSize: 10 },
});
const href = () => '/x';

describe('Visits tab actions', () => {
  it('shows nothing extra by default (the old screens are unchanged)', () => {
    render(<VisitsPanel tab={tab(visit())} hrefFor={href} canSeeReceipt />);
    expect(screen.queryByRole('button', { name: /Cancel visit/ })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.refund.testsLink })).toBeNull();
  });

  it('a WAITING visit gets "Cancel visit"; started or finished visits do not', () => {
    render(
      <VisitsPanel
        tab={tab(
          visit({ id: 'w', bill: bill({ billNumber: 'B-WAIT' }) }),
          visit({ id: 'i', status: 'IN_CONSULTATION', bill: bill({ billNumber: 'B-IN' }) }),
          visit({ id: 'c', status: 'COMPLETED', bill: bill({ billNumber: 'B-DONE' }) }),
          visit({ id: 'x', status: 'CANCELLED', bill: bill({ billNumber: 'B-X' }) }),
        )}
        hrefFor={href}
        canSeeReceipt
        canRequestRefund
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel visit: bill B-WAIT' })).toBeTruthy();
    for (const n of ['B-IN', 'B-DONE', 'B-X']) {
      expect(screen.queryByRole('button', { name: `Cancel visit: bill ${n}` })).toBeNull();
    }
  });

  it('a visit without a bill (no billing permission) has no cancel button', () => {
    render(
      <VisitsPanel
        tab={tab(visit({ bill: undefined }))}
        hrefFor={href}
        canSeeReceipt={false}
        canRequestRefund
      />,
    );
    expect(screen.queryByRole('button', { name: /Cancel visit/ })).toBeNull();
  });

  it('the Tests link shows for visits in consultation or completed, with the permission', () => {
    render(
      <VisitsPanel
        tab={tab(
          visit({ id: 'w' }),
          visit({ id: 'i', status: 'IN_CONSULTATION' }),
          visit({ id: 'c', status: 'COMPLETED' }),
        )}
        hrefFor={href}
        canSeeReceipt
        canSeeTests
      />,
    );
    const links = screen.getAllByRole('link', { name: copy.refund.testsLink });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/app/opd/visits/i/tests',
      '/app/opd/visits/c/tests',
    ]);
  });
});

describe('Bills tab actions', () => {
  it('"Request refund" only before the consultation starts and only when something can be returned', () => {
    render(
      <BillsPanel
        tab={tab(
          visit({ id: 'w', bill: bill({ billNumber: 'B-WAIT' }) }),
          visit({ id: 'i', status: 'IN_CONSULTATION', bill: bill({ billNumber: 'B-IN' }) }),
          visit({
            id: 'r',
            bill: bill({ billNumber: 'B-ALLBACK', refundedPaise: 60000 }),
          }),
          visit({ id: 'f', bill: bill({ billNumber: 'B-FREE', totalPaise: 0, paidPaise: 0 }) }),
        )}
        hrefFor={href}
        canReadBills
        canRequestRefund
      />,
    );
    expect(screen.getByRole('button', { name: 'Request refund: bill B-WAIT' })).toBeTruthy();
    for (const n of ['B-IN', 'B-ALLBACK', 'B-FREE']) {
      expect(screen.queryByRole('button', { name: `Request refund: bill ${n}` })).toBeNull();
    }
  });

  it('shows "Refunded" next to "Paid" when money was returned (fully or in part)', () => {
    render(
      <BillsPanel
        tab={tab(
          visit({ id: 'f', bill: bill({ billNumber: 'B-FULL', refundedPaise: 60000 }) }),
          visit({ id: 'p', bill: bill({ billNumber: 'B-PART', refundedPaise: 10000 }) }),
          visit({ id: 'n', bill: bill({ billNumber: 'B-NONE' }) }),
        )}
        hrefFor={href}
        canReadBills
      />,
    );
    expect(screen.getAllByText('Paid')).toHaveLength(3);
    expect(screen.getAllByText('Refunded')).toHaveLength(1);
    expect(screen.getAllByText('Refunded ₹100.00')).toHaveLength(1);
  });

  it('shows no refund button without the permission', () => {
    render(<BillsPanel tab={tab(visit())} hrefFor={href} canReadBills />);
    expect(screen.queryByRole('button', { name: /Request refund/ })).toBeNull();
  });
});

describe('Tests of one visit', () => {
  const order = (over: Partial<OrderView> = {}): OrderView => ({
    id: 'o1',
    chargeItemId: 'c1',
    code: 'INV001',
    name: 'Blood test',
    status: 'BILLED',
    notTakenReason: null,
    billNumber: 'B-9',
    orderedAt: '2026-11-20T04:00:00.000Z',
    resolvedAt: '2026-11-20T05:00:00.000Z',
    ...over,
  });
  const tests = (over: Partial<VisitTestsResponse> = {}): VisitTestsResponse => ({
    visitId: 'visit-1',
    visitStatus: 'COMPLETED',
    orders: [
      order(),
      order({
        id: 'o2',
        name: 'Scan',
        status: 'NOT_TAKEN',
        notTakenReason: 'elsewhere',
        billNumber: null,
      }),
      order({ id: 'o3', name: 'Xray', status: 'RESULT_READY' }),
    ],
    bills: [
      bill({
        id: 'bill-9',
        billNumber: 'B-9',
        billType: 'INVESTIGATION',
        totalPaise: 25000,
        paidPaise: 25000,
      }),
    ],
    ...over,
  });

  it('lists every test with its status (an unknown status is shown neutrally) and the bills', () => {
    render(<VisitTestsPanel visit={visit()} tests={tests()} canRequestRefund />);
    expect(screen.getByText(copy.doctor.statusBilled)).toBeTruthy();
    expect(screen.getByText('Not taken: elsewhere')).toBeTruthy();
    expect(screen.getByText(copy.doctor.statusOther)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.visit.print }).getAttribute('href')).toBe(
      '/app/opd/visits/visit-1/tests/bill-9/receipt',
    );
    expect(screen.getByRole('button', { name: 'Request refund: bill B-9' })).toBeTruthy();
  });

  it('no refund button without the permission or when everything was returned', () => {
    const first = render(
      <VisitTestsPanel visit={visit()} tests={tests()} canRequestRefund={false} />,
    );
    expect(screen.queryByRole('button', { name: /Request refund/ })).toBeNull();
    first.unmount();
    render(
      <VisitTestsPanel
        visit={visit()}
        tests={tests({ bills: [bill({ id: 'bill-9', billNumber: 'B-9', refundedPaise: 60000 })] })}
        canRequestRefund
      />,
    );
    expect(screen.queryByRole('button', { name: /Request refund/ })).toBeNull();
  });

  it('empty states, and no bills section when the caller may not see money', () => {
    const first = render(
      <VisitTestsPanel visit={visit()} tests={tests({ orders: [], bills: [] })} canRequestRefund />,
    );
    expect(screen.getByText(copy.visit.noOrders)).toBeTruthy();
    expect(screen.getByText(copy.visit.noBills)).toBeTruthy();
    first.unmount();
    render(
      <VisitTestsPanel visit={visit()} tests={tests({ bills: undefined })} canRequestRefund />,
    );
    expect(screen.queryByText(copy.visit.billsHeading)).toBeNull();
  });
});
