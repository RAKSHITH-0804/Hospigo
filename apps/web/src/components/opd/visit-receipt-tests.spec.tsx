import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { VisitReceipt } from '@/components/opd/visit-receipt';
import type { VisitView } from '@/lib/opd/types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const visit: VisitView = {
  id: 'v1',
  status: 'IN_CONSULTATION',
  visitType: 'NEW',
  visitDate: '2026-11-20',
  branch: { id: 'b1', name: 'North Main' },
  patient: {
    id: 'p1',
    uhid: 'UH-1',
    name: 'Asha Rao',
    gender: 'F',
    dobIsEstimated: false,
    ageYears: 30,
    age: { years: 30, months: 0, days: 5 },
  },
  doctor: { id: 'd1', code: 'D2', name: 'Doctor North 2' },
  previousVisitId: null,
  token: null,
  queuedAt: null,
  createdAt: '2026-11-20T04:00:00.000Z',
  bill: {
    id: 'bill-9',
    billNumber: 'B-26/00009',
    billType: 'INVESTIGATION',
    billDate: '2026-11-20T05:00:00.000Z',
    subtotalPaise: 45000,
    taxPaise: 0,
    totalPaise: 45000,
    paidPaise: 45000,
    refundedPaise: 0,
    paymentStatus: 'PAID',
    lines: [
      {
        lineNo: 1,
        kind: 'INVESTIGATION',
        code: 'INV001',
        description: 'Blood test',
        quantity: 1,
        unitPricePaise: 25000,
        taxPaise: 0,
        lineTotalPaise: 25000,
        pricingNote: null,
      },
      {
        lineNo: 2,
        kind: 'INVESTIGATION',
        code: 'INV002',
        description: 'Scan',
        quantity: 1,
        unitPricePaise: 20000,
        taxPaise: 0,
        lineTotalPaise: 20000,
        pricingNote: null,
      },
    ],
    receipts: [
      { receiptNumber: 'R-26/00009', totalPaise: 45000, issuedAt: '2026-11-20T05:00:00Z' },
    ],
    payments: [
      {
        id: 'pay1',
        receiptNumber: 'R-26/00009',
        amountPaise: 45000,
        paymentMode: { code: 'CASH', name: 'Cash' },
        referenceNo: null,
        paidAt: '2026-11-20T05:00:00Z',
      },
    ],
  },
};

describe('receipt: money returned', () => {
  it('shows a Refunded row only when something was returned', () => {
    const first = render(<VisitReceipt visit={visit} hospitalName="Demo North" />);
    expect(screen.queryByText('Refunded')).toBeNull();
    first.unmount();
    render(
      <VisitReceipt
        visit={{ ...visit, bill: { ...visit.bill!, refundedPaise: 20000 } }}
        hospitalName="Demo North"
      />,
    );
    expect(screen.getByText('Refunded')).toBeTruthy();
    expect(screen.getByText('Refunded').closest('tr')!.textContent).toContain('₹200.00');
  });
});

describe('receipt of an investigations bill', () => {
  it('names each test on its line and shows the totals', () => {
    render(<VisitReceipt visit={visit} hospitalName="Demo North" />);
    expect(screen.getByText('Investigation · Blood test')).toBeTruthy();
    expect(screen.getByText('Investigation · Scan')).toBeTruthy();
    expect(screen.getByText('₹250.00')).toBeTruthy();
    expect(screen.getByText('₹200.00')).toBeTruthy();
    expect(screen.getAllByText(/₹450\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText('B-26/00009')).toBeTruthy();
    expect(screen.getByText('R-26/00009')).toBeTruthy();
    // no consultation token on a tests receipt
    expect(screen.queryByTestId('receipt-token')).toBeNull();
  });
});
