import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import {
  approveRefund,
  billTests,
  buildRefundListPath,
  loadPendingTests,
  loadRefundRequest,
  loadRefundRequests,
  loadVisitTests,
  rejectRefund,
  requestCancel,
  requestRefund,
  saveTestOrders,
  searchTests,
} from './tests-client';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    headers: init.headers as Record<string, string>,
  };
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({ ok: true }));
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('tests and refunds client', () => {
  it('searches the tests list through the Next route with q and limit', async () => {
    await searchTests('blood test', 10);
    expect(lastCall().url).toBe('/api/staff/opd/investigations/tests?q=blood+test&limit=10');
    expect(lastCall().method).toBe('GET');
  });

  it('GET calls carry no branch header; writes do (stale-tab guard)', async () => {
    await loadPendingTests();
    expect(lastCall().url).toBe('/api/staff/opd/investigations/pending');
    expect(lastCall().headers['x-hospigo-branch']).toBeUndefined();
    await saveTestOrders('v/1', ['t1', 't2']);
    expect(lastCall()).toMatchObject({
      url: '/api/staff/opd/visits/v%2F1/investigations',
      method: 'PUT',
      body: { chargeItemIds: ['t1', 't2'] },
    });
    expect(lastCall().headers['x-hospigo-branch']).toBe('branch-1');
  });

  it('reads the tests of a visit and bills them with the key, ids and the shown total', async () => {
    await loadVisitTests('v1');
    expect(lastCall().url).toBe('/api/staff/opd/visits/v1/investigations');
    await billTests('v1', {
      idempotencyKey: 'key-12345678',
      orderIds: ['o1'],
      notTaken: [{ orderId: 'o2', reason: 'elsewhere' }],
      expectedTotalPaise: 25000,
      payments: [{ paymentModeCode: 'CASH', amountPaise: 25000 }],
    });
    expect(lastCall()).toMatchObject({
      url: '/api/staff/opd/visits/v1/investigation-bills',
      method: 'POST',
      body: {
        idempotencyKey: 'key-12345678',
        orderIds: ['o1'],
        notTaken: [{ orderId: 'o2', reason: 'elsewhere' }],
        expectedTotalPaise: 25000,
      },
    });
  });

  it('asks for a refund and a cancellation with a reason and a key', async () => {
    await requestRefund('b/1', {
      amountPaise: 500,
      reason: 'wrong',
      idempotencyKey: 'key-12345678',
    });
    expect(lastCall()).toMatchObject({
      url: '/api/staff/opd/bills/b%2F1/refund-requests',
      method: 'POST',
      body: { amountPaise: 500, reason: 'wrong', idempotencyKey: 'key-12345678' },
    });
    await requestCancel('v1', { reason: 'left', idempotencyKey: 'key-87654321' });
    expect(lastCall()).toMatchObject({
      url: '/api/staff/opd/visits/v1/cancel-requests',
      method: 'POST',
      body: { reason: 'left', idempotencyKey: 'key-87654321' },
    });
  });

  it('lists, reads, approves and rejects requests', async () => {
    expect(buildRefundListPath({ page: 1, pageSize: 20 })).toBe(
      '/api/staff/opd/refund-requests?page=1&pageSize=20',
    );
    expect(buildRefundListPath({ status: 'REQUESTED', page: 2, pageSize: 5 })).toBe(
      '/api/staff/opd/refund-requests?status=REQUESTED&page=2&pageSize=5',
    );
    await loadRefundRequests({ status: 'APPROVED', page: 1, pageSize: 20 });
    expect(lastCall().url).toBe(
      '/api/staff/opd/refund-requests?status=APPROVED&page=1&pageSize=20',
    );
    await loadRefundRequest('r/1');
    expect(lastCall().url).toBe('/api/staff/opd/refund-requests/r%2F1');
    await approveRefund('r1', { references: { UPI: 'RF-1' }, note: 'ok' });
    expect(lastCall()).toMatchObject({
      url: '/api/staff/opd/refund-requests/r1/approve',
      method: 'POST',
      body: { references: { UPI: 'RF-1' }, note: 'ok' },
    });
    await rejectRefund('r1', 'not valid');
    expect(lastCall()).toMatchObject({
      url: '/api/staff/opd/refund-requests/r1/reject',
      method: 'POST',
      body: { note: 'not valid' },
    });
  });

  it('keeps the helpful facts of a refusal for the screen', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          code: 'REFUND_EXCEEDS_REFUNDABLE',
          refundablePaise: 5000,
          pendingPaise: 1000,
          paymentModeCode: 'UPI',
          status: 'REJECTED',
          series: 'REFUND',
          max: 30,
        },
        409,
      ),
    );
    const res = await requestRefund('b1', {
      amountPaise: 1,
      reason: 'r',
      idempotencyKey: 'key-12345678',
    });
    expect(res).toEqual({
      ok: false,
      status: 409,
      code: 'REFUND_EXCEEDS_REFUNDABLE',
      refundablePaise: 5000,
      pendingPaise: 1000,
      paymentModeCode: 'UPI',
      upstreamStatus: 'REJECTED',
      series: 'REFUND',
      max: 30,
      matches: undefined,
      fieldErrors: undefined,
      reason: undefined,
      what: undefined,
      totalPaise: undefined,
      fieldCode: undefined,
      index: undefined,
    });
  });
});
