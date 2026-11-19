import { act, fireEvent, render, screen } from '@testing-library/react';
import { RefundDecision } from '@/components/opd/refund-decision';
import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import type { RefundRequestView } from '@/lib/opd/tests-types';

const refreshMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: refreshMock }),
}));

const copy = staffCopy.opd.tests.refunds;
const APPROVE = 'Approve the request for ₹350.00';
const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const request = (over: Partial<RefundRequestView> = {}): RefundRequestView => ({
  id: 'r1',
  type: 'REFUND',
  status: 'REQUESTED',
  amountPaise: 35000,
  reason: 'Test not taken',
  bill: {
    id: 'bill-9',
    billNumber: 'B-9',
    billType: 'INVESTIGATION',
    totalPaise: 50000,
    paidPaise: 50000,
    refundedPaise: 0,
    refundablePaise: 50000,
  },
  visit: {
    id: 'v1',
    status: 'COMPLETED',
    token: 'T3',
    consultationStarted: true,
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
const decided = (over: Partial<RefundRequestView> = {}) => ({
  replayed: false,
  request: request({ status: 'APPROVED', refundNumber: 'RF-26/00001', ...over }),
});

const url = (tail: string) => `/api/staff/opd/refund-requests/r1/${tail}`;
const calls = () =>
  fetchMock.mock.calls.map((c) => ({
    url: c[0] as string,
    method: (c[1] as RequestInit).method,
    body: JSON.parse(String((c[1] as RequestInit).body)),
  }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });

function renderDecision(
  over: { request?: RefundRequestView; canDecide?: boolean; isOwn?: boolean } = {},
) {
  return render(
    <RefundDecision
      request={over.request ?? request()}
      canDecide={over.canDecide ?? true}
      isOwn={over.isOwn ?? false}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('Admin decision on a refund request', () => {
  it('shows nothing without the approve permission, nothing for a decided request', () => {
    const first = renderDecision({ canDecide: false });
    expect(first.container.textContent).toBe('');
    first.unmount();
    const second = renderDecision({ request: request({ status: 'APPROVED' }) });
    expect(second.container.textContent).toBe('');
  });

  it('a request the signed-in person asked for cannot be decided by them', () => {
    renderDecision({ isOwn: true });
    expect(screen.getByText(copy.ownRequest)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });

  it('approve: one click opens the form, then returns the money and shows the voucher', async () => {
    fetchMock.mockResolvedValue(json(decided()));
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: 'Approve the request for ₹350.00' }));
    type(copy.noteLabel, '  ok  ');
    await click('Approve and return ₹350.00');
    expect(calls()).toEqual([{ url: url('approve'), method: 'POST', body: { note: 'ok' } }]);
    expect(screen.getByRole('status').textContent).toBe('Approved. Voucher RF-26/00001.');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('approve with no note sends an empty body', async () => {
    fetchMock.mockResolvedValue(json(decided()));
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await click('Approve and return ₹350.00');
    expect(calls()[0]!.body).toEqual({});
  });

  it('a UPI part needs a reference: the screen asks for it, then approves again with it', async () => {
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    fetchMock.mockResolvedValueOnce(
      json({ code: 'REFERENCE_REQUIRED', paymentModeCode: 'UPI' }, 400),
    );
    await click('Approve and return ₹350.00');
    expect(screen.getByRole('alert').textContent).toBe(
      'The UPI part needs a reference number. Enter it and approve again.',
    );
    // cannot be sent until the reference is typed
    expect(
      (screen.getByRole('button', { name: 'Approve and return ₹350.00' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    type('Reference no. for UPI', ' RF-UPI-1 ');
    fetchMock.mockResolvedValueOnce(json(decided()));
    await click('Approve and return ₹350.00');
    expect(calls()[1]).toEqual({
      url: url('approve'),
      method: 'POST',
      body: { references: { UPI: 'RF-UPI-1' } },
    });
    expect(screen.getByRole('status').textContent).toContain('Approved. Voucher');
  });

  it('several modes can each ask for a reference, one after the other', async () => {
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    fetchMock.mockResolvedValueOnce(
      json({ code: 'REFERENCE_REQUIRED', paymentModeCode: 'UPI' }, 400),
    );
    await click('Approve and return ₹350.00');
    type('Reference no. for UPI', 'U1');
    fetchMock.mockResolvedValueOnce(
      json({ code: 'REFERENCE_REQUIRED', paymentModeCode: 'CARD' }, 400),
    );
    await click('Approve and return ₹350.00');
    expect(screen.getByLabelText('Reference no. for CARD')).toBeTruthy();
    type('Reference no. for CARD', 'C1');
    fetchMock.mockResolvedValueOnce(json(decided()));
    await click('Approve and return ₹350.00');
    expect(calls()[2]!.body).toEqual({ references: { UPI: 'U1', CARD: 'C1' } });
  });

  it('plain messages for the refusals: consultation started, already decided, own request, invalid reference', async () => {
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    for (const [code, status, message] of [
      ['CONSULTATION_STARTED', 409, staffCopy.opd.errors.CONSULTATION_STARTED],
      ['REQUEST_ALREADY_DECIDED', 409, staffCopy.opd.errors.REQUEST_ALREADY_DECIDED],
      ['SELF_APPROVAL_FORBIDDEN', 403, staffCopy.opd.errors.SELF_APPROVAL_FORBIDDEN],
      ['REFERENCE_INVALID', 400, staffCopy.opd.errors.REFERENCE_INVALID],
      ['RULE_REFUSED', 409, staffCopy.opd.errors.RULE_REFUSED],
      ['FORBIDDEN', 403, staffCopy.errors.forbidden],
    ] as const) {
      fetchMock.mockResolvedValueOnce(json({ code }, status));
      await click('Approve and return ₹350.00');
      expect({ code, text: screen.getByRole('alert').textContent }).toEqual({
        code,
        text: message,
      });
    }
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('a double click sends ONE approval', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    const button = screen.getByRole('button', { name: 'Approve and return ₹350.00' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(calls()).toHaveLength(1);
    await act(async () => {
      release(json(decided()));
    });
  });

  it('a cancellation that returns nothing says so and shows no voucher', async () => {
    fetchMock.mockResolvedValue(json(decided({ refundNumber: null })));
    renderDecision({ request: request({ type: 'CANCEL_VISIT', amountPaise: 0 }) });
    fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    await click(copy.confirmApproveFree);
    expect(screen.getByRole('status').textContent).toBe(copy.doneApprovedFree);
  });

  it('reject needs a note, sends it, and says rejected', async () => {
    fetchMock.mockResolvedValue(
      json({ replayed: false, request: request({ status: 'REJECTED' }) }),
    );
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: 'Reject the request for ₹350.00' }));
    const button = screen.getByRole('button', { name: copy.confirmReject }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    type(copy.rejectNoteLabel, '   ');
    expect(button.disabled).toBe(true);
    type(copy.rejectNoteLabel, ' Patient was seen ');
    await click(copy.confirmReject);
    expect(calls()).toEqual([
      { url: url('reject'), method: 'POST', body: { note: 'Patient was seen' } },
    ]);
    expect(screen.getByRole('status').textContent).toBe(copy.doneRejected);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('a double click on Reject sends ONE rejection', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: /^Reject/ }));
    type(copy.rejectNoteLabel, 'Patient was seen');
    const button = screen.getByRole('button', { name: copy.confirmReject });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(calls()).toHaveLength(1);
    await act(async () => {
      release(json({ replayed: false, request: request({ status: 'REJECTED' }) }));
    });
  });

  it('Close goes back to the two buttons without sending anything', () => {
    renderDecision();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    fireEvent.click(screen.getByRole('button', { name: copy.close }));
    expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
