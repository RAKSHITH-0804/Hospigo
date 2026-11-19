import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TestsToBill } from '@/components/opd/tests-to-bill';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import type { PendingTestsResponse, PendingVisit } from '@/lib/opd/tests-types';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const copy = staffCopy.opd.tests.reception;
const pay = staffCopy.opd.newVisit;
const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const modes = {
  items: [
    { code: 'CASH', name: 'Cash', requiresReference: false },
    { code: 'UPI', name: 'UPI', requiresReference: true },
  ],
  defaultCode: 'CASH',
  maxLines: 4,
};

const visit = (over: Partial<PendingVisit> = {}): PendingVisit => ({
  visitId: 'visit-1',
  visitStatus: 'IN_CONSULTATION',
  token: 'T3',
  patient: { id: 'p1', uhid: 'UH-1', name: 'Asha Rao' },
  doctor: { code: 'D2', name: 'Doctor North 2' },
  orders: [
    {
      id: 'o1',
      chargeItemId: 'c1',
      code: 'INV001',
      name: 'Blood test',
      pricePaise: 25000,
      orderedAt: '2026-11-20T04:00:00.000Z',
    },
    {
      id: 'o2',
      chargeItemId: 'c2',
      code: 'INV002',
      name: 'Scan',
      pricePaise: 20000,
      orderedAt: '2026-11-20T04:01:00.000Z',
    },
  ],
  totalPaise: 45000,
  ...over,
});
const list = (...items: PendingVisit[]): PendingTestsResponse => ({ items });

const billed = (over: Record<string, unknown> = {}) => ({
  replayed: false,
  visitId: 'visit-1',
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
    receipts: [
      { receiptNumber: 'R-26/00009', totalPaise: 45000, issuedAt: '2026-11-20T05:00:00Z' },
    ],
  },
  orders: [],
  ...over,
});

type Handler = (body: Record<string, unknown>) => unknown;
function api(handlers: Record<string, Handler>) {
  fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unexpected fetch ${key}`);
    }
    return handler(init?.body ? JSON.parse(String(init.body)) : {});
  });
}
const BILL = 'POST /api/staff/opd/visits/visit-1/investigation-bills';
const PENDING = 'GET /api/staff/opd/investigations/pending';
const sent = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${c[0]}`);
const bodies = (key: string) =>
  fetchMock.mock.calls
    .filter((c) => `${(c[1] as RequestInit).method} ${c[0]}` === key)
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)));

function renderScreen(initial: PendingTestsResponse = list(visit()), refreshSeconds = 0) {
  return render(
    <TestsToBill initial={initial} paymentModes={modes} refreshSeconds={refreshSeconds} />,
  );
}
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Bill tests for Asha Rao' }));
const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  fetchMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('reception: tests to bill', () => {
  it('lists the patients with tests to bill; an empty list says so', () => {
    const first = renderScreen();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Blood test, Scan')).toBeTruthy();
    expect(screen.getByText('T3')).toBeTruthy();
    expect(screen.getByText(/1 patients with tests to bill/)).toBeTruthy();
    first.unmount();
    renderScreen(list());
    expect(screen.getByText(copy.emptyTitle)).toBeTruthy();
  });

  it('opens one patient: every test ticked with its price, the total and cash on one row', () => {
    renderScreen();
    expect(screen.queryByText('Bill tests for Asha Rao', { selector: 'h2,h3,div' })).toBeNull();
    open();
    expect(
      (screen.getByLabelText('Patient will take Blood test') as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText('Patient will take Scan') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByText('₹250.00')).toBeTruthy();
    expect(screen.getByText('₹200.00')).toBeTruthy();
    expect(screen.getByText(`${copy.totalCaption}: ₹450.00`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take cash ₹450.00' })).toBeTruthy();
  });

  it('takes cash for all tests: sends the ids, the shown total and one key, then shows the receipt link', async () => {
    api({ [BILL]: () => json(billed()), [PENDING]: () => json(list()) });
    renderScreen();
    open();
    await click('Take cash ₹450.00');
    const [body] = bodies(BILL);
    expect(body).toMatchObject({
      orderIds: ['o1', 'o2'],
      expectedTotalPaise: 45000,
      payments: [{ paymentModeCode: 'CASH', amountPaise: 45000 }],
    });
    expect(String(body.idempotencyKey).length).toBeGreaterThanOrEqual(8);
    expect(body.notTaken).toBeUndefined();
    expect(screen.getByText(copy.doneTitle)).toBeTruthy();
    expect(screen.getByText(/Asha Rao: bill B-26\/00009 · receipt R-26\/00009/)).toBeTruthy();
    const link = screen.getByRole('link', { name: copy.printReceipt });
    expect(link.getAttribute('href')).toBe('/app/opd/visits/visit-1/tests/bill-9/receipt');
    // the list was refreshed: the billed patient is gone
    expect(sent()).toContain(PENDING);
  });

  it('an unticked test needs a reason, is not charged and is sent as not taken', async () => {
    api({ [BILL]: () => json(billed()), [PENDING]: () => json(list()) });
    renderScreen();
    open();
    fireEvent.click(screen.getByLabelText('Patient will take Scan'));
    expect(screen.getByText(`${copy.totalCaption}: ₹250.00`)).toBeTruthy();
    // no reason yet: blocked
    expect(screen.getByText(copy.reasonNeeded)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Take cash/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    type('Why is Scan not taken?', 'Done at another hospital');
    expect(screen.queryByText(copy.reasonNeeded)).toBeNull();
    await click('Take cash ₹250.00');
    const [body] = bodies(BILL);
    expect(body).toMatchObject({
      orderIds: ['o1'],
      notTaken: [{ orderId: 'o2', reason: 'Done at another hospital' }],
      expectedTotalPaise: 25000,
      payments: [{ paymentModeCode: 'CASH', amountPaise: 25000 }],
    });
  });

  it('nothing ticked cannot be billed and says so', () => {
    renderScreen();
    open();
    fireEvent.click(screen.getByLabelText('Patient will take Blood test'));
    fireEvent.click(screen.getByLabelText('Patient will take Scan'));
    expect(screen.getByText(copy.noneTaken)).toBeTruthy();
    expect(screen.queryByText(pay.paymentHeading)).toBeNull();
    expect(
      (screen.getByRole('button', { name: copy.createFree }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a test with no price is shown with a warning, cannot be ticked and is never sent', async () => {
    api({ [BILL]: () => json(billed()), [PENDING]: () => json(list()) });
    const v = visit();
    v.orders[1] = { ...v.orders[1]!, pricePaise: null };
    renderScreen(list(v));
    open();
    expect(screen.getByText(copy.priceNotSet)).toBeTruthy();
    const box = screen.getByLabelText('Patient will take Scan') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    await click('Take cash ₹250.00');
    const [body] = bodies(BILL);
    expect(body.orderIds).toEqual(['o1']);
    expect(body.notTaken).toBeUndefined();
  });

  it('a split payment (UPI + cash) must add up and needs the UPI reference; then it is sent as one request', async () => {
    api({ [BILL]: () => json(billed()), [PENDING]: () => json(list()) });
    renderScreen();
    open();
    await click(pay.addPayment);
    // first row shows the whole total to be cut down
    type(`${pay.paymentAmountLabel} 1`, '300');
    expect(screen.getByText('Still to collect: ₹150.00')).toBeTruthy();
    type(`${pay.paymentAmountLabel} 2`, '150');
    const payButton = screen.getByRole('button', {
      name: 'Take payment ₹450.00',
    }) as HTMLButtonElement;
    expect(payButton.disabled).toBe(true);
    type(`${pay.paymentReferenceLabel} 2`, 'UPI-77');
    expect(payButton.disabled).toBe(false);
    await click('Take payment ₹450.00');
    const [body] = bodies(BILL);
    expect(body.payments).toEqual([
      { paymentModeCode: 'CASH', amountPaise: 30000 },
      { paymentModeCode: 'UPI', amountPaise: 15000, referenceNo: 'UPI-77' },
    ]);
  });

  it('a double click sends ONE request', async () => {
    let release: (v: unknown) => void = () => undefined;
    api({
      [BILL]: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      [PENDING]: () => json(list()),
    });
    renderScreen();
    open();
    const button = screen.getByRole('button', { name: 'Take cash ₹450.00' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(bodies(BILL)).toHaveLength(1);
    await act(async () => {
      release(json(billed()));
    });
  });

  it('a retry after a failure keeps the key; changing a choice gives a new key', async () => {
    api({ [BILL]: () => json({ code: 'UNAVAILABLE' }, 503) });
    renderScreen();
    open();
    await click('Take cash ₹450.00');
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    await click('Take cash ₹450.00');
    const [first, second] = bodies(BILL);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    // a different choice is a different request
    fireEvent.click(screen.getByLabelText('Patient will take Scan'));
    type('Why is Scan not taken?', 'no');
    await click('Take cash ₹250.00');
    const third = bodies(BILL)[2]!;
    expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
    // and a changed payment row is a new request too
    await click(pay.addPayment);
    type(`${pay.paymentAmountLabel} 1`, '100');
    type(`${pay.paymentAmountLabel} 2`, '150');
    type(`${pay.paymentReferenceLabel} 2`, 'R1');
    await click('Take payment ₹250.00');
    expect(bodies(BILL)[3]!.idempotencyKey).not.toBe(third.idempotencyKey);
  });

  it('a changed price: nothing is charged, the list is reloaded, the receptionist sees why', async () => {
    api({
      [BILL]: () => json({ code: 'PRICE_CHANGED', totalPaise: 50000 }, 409),
      [PENDING]: () =>
        json(
          list(
            visit({
              orders: [{ ...visit().orders[0]!, pricePaise: 30000 }, visit().orders[1]!],
            }),
          ),
        ),
    });
    renderScreen();
    open();
    await click('Take cash ₹450.00');
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.opd.errors.PRICE_CHANGED);
    expect(sent()).toContain(PENDING);
    expect(screen.getByText(`${copy.totalCaption}: ₹500.00`)).toBeTruthy();
    expect(screen.queryByText(copy.doneTitle)).toBeNull();
  });

  it('a test that was billed meanwhile: the list is reloaded and the message is clear', async () => {
    api({
      [BILL]: () => json({ code: 'ORDERS_NOT_AVAILABLE' }, 409),
      [PENDING]: () => json(list()),
    });
    renderScreen();
    open();
    await click('Take cash ₹450.00');
    expect(sent()).toContain(PENDING);
    expect(screen.queryByText(copy.doneTitle)).toBeNull();
  });

  it('free tests: no payment box, no payments sent', async () => {
    api({
      [BILL]: () => json(billed({ bill: { ...billed().bill, totalPaise: 0, paidPaise: 0 } })),
      [PENDING]: () => json(list()),
    });
    const v = visit();
    v.orders = [{ ...v.orders[0]!, pricePaise: 0 }];
    renderScreen(list(v));
    open();
    expect(screen.queryByText(pay.paymentHeading)).toBeNull();
    await click(copy.createFree);
    const [body] = bodies(BILL);
    expect(body.payments).toBeUndefined();
    expect(body.expectedTotalPaise).toBe(0);
  });

  it('a refused request (no permission) shows the plain message and stays on the panel', async () => {
    api({ [BILL]: () => json({ code: 'FORBIDDEN' }, 403) });
    renderScreen();
    open();
    await click('Take cash ₹450.00');
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
    expect(screen.getByText(`${copy.totalCaption}: ₹450.00`)).toBeTruthy();
  });

  it('Refresh reloads the list; a failed refresh keeps the list on screen and says so', async () => {
    api({ [PENDING]: () => json({ code: 'UNAVAILABLE' }, 503) });
    renderScreen();
    await click(copy.refresh);
    expect(screen.getByRole('alert').textContent).toBe(copy.refreshFailed);
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    api({
      [PENDING]: () => json(list(visit({ patient: { id: 'p2', uhid: 'UH-2', name: 'Ravi K' } }))),
    });
    await click(copy.refresh);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Ravi K')).toBeTruthy();
  });

  it('refreshes by itself after the set time, but not while the tab is hidden', async () => {
    jest.useFakeTimers();
    try {
      api({ [PENDING]: () => json(list()) });
      renderScreen(list(visit()), 20);
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      await act(async () => {
        jest.advanceTimersByTime(21000);
      });
      expect(fetchMock).not.toHaveBeenCalled();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      await act(async () => {
        jest.advanceTimersByTime(20000);
      });
      expect(sent()).toEqual([PENDING]);
    } finally {
      jest.useRealTimers();
    }
  });
});
