import { act, fireEvent, render, screen } from '@testing-library/react';
import { RefundRequestAction } from '@/components/opd/refund-request-action';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';

const copy = staffCopy.opd.tests.refund;
const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const REFUND_URL = '/api/staff/opd/bills/bill-1/refund-requests';
const CANCEL_URL = '/api/staff/opd/visits/visit-1/cancel-requests';

const requestOf = (over: Record<string, unknown> = {}) => ({
  replayed: false,
  request: { id: 'r1', status: 'REQUESTED', amountPaise: 10000, ...over },
});
const calls = () =>
  fetchMock.mock.calls.map((c) => ({
    url: c[0] as string,
    method: (c[1] as RequestInit).method,
    body: JSON.parse(String((c[1] as RequestInit).body)),
  }));

function renderAction(kind: 'REFUND' | 'CANCEL' = 'REFUND', refundablePaise = 60000) {
  return render(
    <RefundRequestAction
      kind={kind}
      billId="bill-1"
      visitId="visit-1"
      billNumber="B-26/00001"
      refundablePaise={refundablePaise}
    />,
  );
}
const openForm = (kind: 'REFUND' | 'CANCEL' = 'REFUND') =>
  fireEvent.click(
    screen.getByRole('button', {
      name: `${kind === 'REFUND' ? copy.requestRefund : copy.cancelVisit}: bill B-26/00001`,
    }),
  );
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const send = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: copy.send }));
  });

beforeEach(() => {
  fetchMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('request a refund', () => {
  it('opens a small form with the most that can be returned already filled in', () => {
    renderAction();
    expect(screen.queryByLabelText(copy.reasonLabel)).toBeNull();
    openForm();
    expect((screen.getByLabelText(copy.amountLabel) as HTMLInputElement).value).toBe('600.00');
    expect(screen.getByText('Can still be returned: ₹600.00.')).toBeTruthy();
    expect((screen.getByRole('button', { name: copy.send }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: copy.close }));
    expect(screen.queryByLabelText(copy.reasonLabel)).toBeNull();
  });

  it('needs a reason and an amount above zero, up to what can be returned', () => {
    renderAction();
    openForm();
    const sendButton = screen.getByRole('button', { name: copy.send }) as HTMLButtonElement;
    type(copy.reasonLabel, 'Wrong bill');
    expect(sendButton.disabled).toBe(false);
    for (const bad of ['0', '0.00', '600.01', '-5', 'abc', '1.234']) {
      type(copy.amountLabel, bad);
      expect({ bad, disabled: sendButton.disabled }).toEqual({ bad, disabled: true });
    }
    expect(screen.getByText(copy.amountInvalid)).toBeTruthy();
    type(copy.amountLabel, '250.50');
    expect(sendButton.disabled).toBe(false);
    type(copy.reasonLabel, '   ');
    expect(sendButton.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the amount in paise with the reason and a key, then says an Admin will decide', async () => {
    fetchMock.mockResolvedValue(json(requestOf({ amountPaise: 25050 })));
    renderAction();
    openForm();
    type(copy.amountLabel, '250.50');
    type(copy.reasonLabel, '  Wrong bill ');
    await send();
    const [call] = calls();
    expect(call).toMatchObject({
      url: REFUND_URL,
      method: 'POST',
      body: { amountPaise: 25050, reason: 'Wrong bill' },
    });
    expect(String(call!.body.idempotencyKey).length).toBeGreaterThanOrEqual(8);
    expect(screen.getByRole('status').textContent).toBe(
      'Request sent for ₹250.50 on bill B-26/00001. An Admin will decide.',
    );
    expect(screen.queryByLabelText(copy.reasonLabel)).toBeNull();
  });

  it('a double click sends ONE request', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderAction();
    openForm();
    type(copy.reasonLabel, 'Wrong bill');
    const button = screen.getByRole('button', { name: copy.send });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(calls()).toHaveLength(1);
    await act(async () => {
      release(json(requestOf()));
    });
  });

  it('a retry after a failure keeps the key; changing the reason or the amount gives a new key', async () => {
    fetchMock.mockResolvedValue(json({ code: 'UNAVAILABLE' }, 503));
    renderAction();
    openForm();
    type(copy.reasonLabel, 'Wrong bill');
    await send();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.unreachable);
    await send();
    type(copy.reasonLabel, 'Wrong bill again');
    await send();
    type(copy.amountLabel, '100');
    await send();
    const keys = calls().map((c) => c.body.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });

  it('explains a refusal in plain words, with the numbers when the amount was too high', async () => {
    renderAction();
    openForm();
    type(copy.reasonLabel, 'Wrong bill');
    fetchMock.mockResolvedValueOnce(
      json({ code: 'REFUND_EXCEEDS_REFUNDABLE', refundablePaise: 50000, pendingPaise: 10000 }, 409),
    );
    await send();
    expect(screen.getByRole('alert').textContent).toBe(
      'That is more than can be returned now: ₹500.00 left, ₹100.00 already asked for.',
    );
    fetchMock.mockResolvedValueOnce(json({ code: 'CONSULTATION_STARTED' }, 409));
    await send();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.opd.errors.CONSULTATION_STARTED);
    fetchMock.mockResolvedValueOnce(json({ code: 'FORBIDDEN' }, 403));
    await send();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.errors.forbidden);
    // the form stays open for another try
    expect(screen.getByLabelText(copy.reasonLabel)).toBeTruthy();
  });
});

describe('cancel a waiting visit', () => {
  it('asks to cancel with the amount to return (zero is allowed) and says the patient stays in the queue', async () => {
    fetchMock.mockResolvedValue(json(requestOf({ amountPaise: 0 })));
    renderAction('CANCEL', 60000);
    openForm('CANCEL');
    expect(screen.getByText(new RegExp(copy.cancelAmountHint))).toBeTruthy();
    type(copy.amountLabel, '0');
    type(copy.reasonLabel, 'Patient left');
    await send();
    expect(calls()[0]).toMatchObject({
      url: CANCEL_URL,
      method: 'POST',
      body: { reason: 'Patient left', amountPaise: 0 },
    });
    expect(screen.getByRole('status').textContent).toBe(copy.sentCancel);
  });

  it('a free visit (nothing paid) can still be cancelled for 0', async () => {
    fetchMock.mockResolvedValue(json(requestOf({ amountPaise: 0 })));
    renderAction('CANCEL', 0);
    openForm('CANCEL');
    expect((screen.getByLabelText(copy.amountLabel) as HTMLInputElement).value).toBe('0.00');
    type(copy.reasonLabel, 'Not needed');
    await send();
    expect(calls()[0]!.body.amountPaise).toBe(0);
  });

  it('refuses more than the fee', () => {
    renderAction('CANCEL', 50000);
    openForm('CANCEL');
    type(copy.reasonLabel, 'Patient left');
    type(copy.amountLabel, '500.01');
    expect((screen.getByRole('button', { name: copy.send }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(copy.cancelAmountInvalid)).toBeTruthy();
  });

  it('an open cancellation shows the plain message', async () => {
    fetchMock.mockResolvedValue(json({ code: 'REFUND_REQUEST_OPEN' }, 409));
    renderAction('CANCEL');
    openForm('CANCEL');
    type(copy.reasonLabel, 'Patient left');
    await send();
    expect(screen.getByRole('alert').textContent).toBe(staffCopy.opd.errors.REFUND_REQUEST_OPEN);
  });
});
