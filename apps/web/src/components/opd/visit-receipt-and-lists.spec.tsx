import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BillsPanel, VisitsPanel } from '@/components/opd/visit-lists';
import { VisitReceipt } from '@/components/opd/visit-receipt';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { BillView, VisitListResponse, VisitView } from '@/lib/opd/types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const printSpy = jest.fn();
beforeEach(() => {
  printSpy.mockReset();
  window.print = printSpy;
});

const bill: BillView = {
  id: 'b1',
  billNumber: '2627/00012',
  billType: 'CONSULTATION',
  billDate: '2026-11-18T09:00:00.000Z',
  subtotalPaise: 60_000,
  taxPaise: 0,
  totalPaise: 60_000,
  paidPaise: 60_000,
  refundedPaise: 0,
  paymentStatus: 'PAID',
  lines: [
    {
      lineNo: 1,
      kind: 'CONSULTATION',
      code: 'DR001',
      description: 'Dr Meena',
      quantity: 1,
      unitPricePaise: 50_000,
      taxPaise: 0,
      lineTotalPaise: 50_000,
      pricingNote: null,
    },
    {
      lineNo: 2,
      kind: 'REGISTRATION',
      code: 'REG',
      description: 'Registration',
      quantity: 1,
      unitPricePaise: 10_000,
      taxPaise: 0,
      lineTotalPaise: 10_000,
      pricingNote: null,
    },
  ],
  payments: [
    {
      id: 'pay1',
      receiptNumber: '2627/00007',
      amountPaise: 60_000,
      paymentMode: { code: 'CASH', name: 'Cash' },
      referenceNo: null,
      paidAt: '2026-11-18T09:00:01.000Z',
    },
  ],
};

function visit(overrides: Partial<VisitView> = {}): VisitView {
  return {
    id: 'v1',
    status: 'WAITING',
    visitType: 'NEW',
    visitDate: '2026-11-18',
    branch: { id: 'br1', name: 'East Wing' },
    patient: { id: 'p1', uhid: 'NHEL0001', name: 'Ravi Kumar' },
    doctor: { id: 'd1', code: 'DR001', name: 'Dr Meena' },
    previousVisitId: null,
    token: { date: '2026-11-18', no: 7, label: 'T7' },
    queuedAt: '2026-11-18T09:00:01.000Z',
    createdAt: '2026-11-18T09:00:00.000Z',
    bill,
    ...overrides,
  };
}

describe('VisitReceipt', () => {
  const copy = staffCopy.opd.receipt;

  it('shows token, numbers, patient, doctor, lines, total and the cash payment, in paise-exact money', () => {
    render(<VisitReceipt visit={visit()} hospitalName="Demo North Clinic" />);
    const receipt = screen.getByLabelText(copy.title);
    expect(within(receipt).getByText('Demo North Clinic')).toBeTruthy();
    expect(within(receipt).getByTestId('receipt-token').textContent).toBe('T7');
    for (const text of [
      '2627/00012',
      '2627/00007',
      'Ravi Kumar',
      'NHEL0001',
      'Dr Meena',
      'East Wing',
    ]) {
      expect(within(receipt).getByText(text)).toBeTruthy();
    }
    expect(within(receipt).getByText('18 Nov 2026')).toBeTruthy();
    expect(within(receipt).getByText(formatPaise(50_000))).toBeTruthy();
    expect(within(receipt).getByText(formatPaise(10_000))).toBeTruthy();
    // The total and the cash payment line both show it.
    expect(within(receipt).getAllByText(formatPaise(60_000)).length).toBeGreaterThanOrEqual(2);
    expect(within(receipt).getByText(`${formatPaise(60_000)} · ${copy.statusPaid}`)).toBeTruthy();
    expect(within(receipt).getByText(`${copy.mode}: Cash`)).toBeTruthy();
    expect(
      within(receipt).getByText(`${staffCopy.opd.newVisit.lineConsultation} · Dr Meena`),
    ).toBeTruthy();
    expect(within(receipt).getByText(staffCopy.opd.newVisit.lineRegistration)).toBeTruthy();
  });

  it('prints through the browser print dialog and links back to the patient (not part of the print)', () => {
    render(<VisitReceipt visit={visit()} hospitalName="Demo" />);
    fireEvent.click(screen.getByRole('button', { name: copy.print }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: copy.print }).closest('.no-print')).not.toBeNull();
    expect(screen.getByLabelText(copy.title).closest('.no-print')).toBeNull();
  });

  it('a free follow-up shows a zero bill, no receipt number, and the free note', () => {
    const free: BillView = {
      ...bill,
      subtotalPaise: 0,
      totalPaise: 0,
      paidPaise: 0,
      lines: [
        {
          ...bill.lines![0]!,
          unitPricePaise: 0,
          lineTotalPaise: 0,
          pricingNote: 'FOLLOW_UP_FREE_WINDOW',
        },
      ],
      payments: [],
    };
    render(
      <VisitReceipt visit={visit({ bill: free, visitType: 'FOLLOW_UP' })} hospitalName="Demo" />,
    );
    expect(screen.queryByText(copy.receiptNumber)).toBeNull();
    expect(screen.getByText(copy.freeFollowUp)).toBeTruthy();
    expect(screen.getAllByText(formatPaise(0)).length).toBeGreaterThan(0);
  });

  it('a free repeat visit shows the repeat-visit note, not the follow-up one', () => {
    const free: BillView = {
      ...bill,
      subtotalPaise: 0,
      totalPaise: 0,
      paidPaise: 0,
      lines: [
        {
          ...bill.lines![0]!,
          unitPricePaise: 0,
          lineTotalPaise: 0,
          pricingNote: 'REPEAT_VISIT_FREE_WINDOW',
        },
      ],
      payments: [],
    };
    render(<VisitReceipt visit={visit({ bill: free })} hospitalName="Demo" />);
    expect(screen.getByText(copy.freeRepeatVisit)).toBeTruthy();
    expect(screen.queryByText(copy.freeFollowUp)).toBeNull();
  });

  it('shows a payment reference when there is one', () => {
    const upi: BillView = {
      ...bill,
      payments: [
        {
          ...bill.payments![0]!,
          paymentMode: { code: 'UPI', name: 'UPI' },
          referenceNo: 'UTR-123',
        },
      ],
    };
    render(<VisitReceipt visit={visit({ bill: upi })} hospitalName="Demo" />);
    expect(screen.getByText(`${copy.mode}: UPI · ${copy.reference}: UTR-123`)).toBeTruthy();
  });

  it('without a bill (no billing permission) it shows a calm message and no amounts', () => {
    render(<VisitReceipt visit={visit({ bill: undefined })} hospitalName="Demo" />);
    expect(screen.getByText(copy.noBillTitle)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₹/);
  });
});

describe('VisitsPanel and BillsPanel', () => {
  const tabs = staffCopy.opd.tabs;
  const data: VisitListResponse = {
    items: [
      visit({ id: 'v2', status: 'COMPLETED', visitType: 'FOLLOW_UP', token: null }),
      visit({ id: 'v1' }),
    ],
    total: 25,
    page: 2,
    pageSize: 10,
  };
  const hrefFor = (page: number) => `/app/patients/p1?tab=visits&vp=${page}`;

  it('lists visits (date, doctor, type, token, status) with receipt links only when bills may be read', () => {
    const { unmount } = render(
      <VisitsPanel tab={{ status: 'ok', data }} hrefFor={hrefFor} canSeeReceipt />,
    );
    const table = screen.getByRole('table', { name: tabs.listAria });
    expect(within(table).getAllByText('Dr Meena')).toHaveLength(2);
    expect(within(table).getByText(tabs.typeFollowUp)).toBeTruthy();
    expect(within(table).getByText(tabs.statusCompleted)).toBeTruthy();
    expect(within(table).getByText(tabs.statusWaiting)).toBeTruthy();
    expect(within(table).getByText('T7')).toBeTruthy();
    const links = within(table).getAllByRole('link', { name: tabs.receiptLink });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/app/opd/visits/v2/receipt',
      '/app/opd/visits/v1/receipt',
    ]);
    unmount();
    render(<VisitsPanel tab={{ status: 'ok', data }} hrefFor={hrefFor} canSeeReceipt={false} />);
    expect(screen.queryByRole('link', { name: tabs.receiptLink })).toBeNull();
  });

  it('pages with plain links: previous and next point at the right pages', () => {
    render(<VisitsPanel tab={{ status: 'ok', data }} hrefFor={hrefFor} canSeeReceipt />);
    expect(screen.getByRole('link', { name: tabs.previous }).getAttribute('href')).toBe(hrefFor(1));
    expect(screen.getByRole('link', { name: tabs.next }).getAttribute('href')).toBe(hrefFor(3));
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();
    expect(screen.getByText(/25 in total/)).toBeTruthy();
  });

  it('first and last page hide the missing direction', () => {
    const first = render(
      <VisitsPanel
        tab={{ status: 'ok', data: { ...data, page: 1 } }}
        hrefFor={hrefFor}
        canSeeReceipt
      />,
    );
    expect(screen.queryByRole('link', { name: tabs.previous })).toBeNull();
    expect(screen.getByRole('link', { name: tabs.next })).toBeTruthy();
    first.unmount();
    render(
      <VisitsPanel
        tab={{ status: 'ok', data: { ...data, page: 3 } }}
        hrefFor={hrefFor}
        canSeeReceipt
      />,
    );
    expect(screen.queryByRole('link', { name: tabs.next })).toBeNull();
  });

  it('empty, no-access and error states', () => {
    const empty = render(
      <VisitsPanel
        tab={{ status: 'ok', data: { items: [], total: 0, page: 1, pageSize: 10 } }}
        hrefFor={hrefFor}
        canSeeReceipt
      />,
    );
    expect(screen.getByText(tabs.visitsEmptyTitle)).toBeTruthy();
    empty.unmount();
    const denied = render(
      <VisitsPanel tab={{ status: 'noAccess' }} hrefFor={hrefFor} canSeeReceipt />,
    );
    expect(screen.getByText(tabs.noAccessTitle)).toBeTruthy();
    denied.unmount();
    render(
      <VisitsPanel
        tab={{ status: 'error', message: staffCopy.errors.unreachable }}
        hrefFor={hrefFor}
        canSeeReceipt
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
  });

  it('bills: number, date, doctor, total in money format and payment status; needs billing permission', () => {
    const { unmount } = render(
      <BillsPanel tab={{ status: 'ok', data }} hrefFor={hrefFor} canReadBills />,
    );
    const table = screen.getByRole('table', { name: tabs.billsHeading });
    expect(within(table).getAllByText('2627/00012')).toHaveLength(2);
    expect(within(table).getAllByText(formatPaise(60_000))).toHaveLength(2);
    expect(within(table).getAllByText(staffCopy.opd.receipt.statusPaid)).toHaveLength(2);
    unmount();
    // Without billing.read nothing monetary is shown, even if the data were passed in.
    render(<BillsPanel tab={{ status: 'ok', data }} hrefFor={hrefFor} canReadBills={false} />);
    expect(screen.getByText(tabs.noAccessTitle)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₹|2627/);
  });

  it('bills: visits without a bill are left out; an empty result says so', () => {
    render(
      <BillsPanel
        tab={{ status: 'ok', data: { ...data, items: [visit({ bill: null })] } }}
        hrefFor={hrefFor}
        canReadBills
      />,
    );
    expect(screen.getByText(tabs.billsEmptyTitle)).toBeTruthy();
  });
});
