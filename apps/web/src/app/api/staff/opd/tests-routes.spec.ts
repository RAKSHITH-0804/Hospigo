/**
 * @jest-environment node
 */

const ACCESS_COOKIE = `h.${Buffer.from(JSON.stringify({ branchId: 'branch-1' })).toString('base64url')}.s`;
const callStaffApiMock = jest.fn();
let hasAccessCookie = true;

jest.mock('@/lib/auth/staff-api', () => ({
  callStaffApi: (...args: unknown[]) => callStaffApiMock(...args),
}));

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      hasAccessCookie && name === 'hospigo_access' ? { value: ACCESS_COOKIE } : undefined,
  }),
}));

import { GET as getTests } from './investigations/tests/route';
import { GET as getPending } from './investigations/pending/route';
import { GET as getVisitTests, PUT as putVisitTests } from './visits/[id]/investigations/route';
import { POST as postBill } from './visits/[id]/investigation-bills/route';
import { POST as postCancel } from './visits/[id]/cancel-requests/route';
import { POST as postRefund } from './bills/[billId]/refund-requests/route';
import { GET as getRefunds } from './refund-requests/route';
import { GET as getRefund } from './refund-requests/[id]/route';
import { POST as postApprove } from './refund-requests/[id]/approve/route';
import { POST as postReject } from './refund-requests/[id]/reject/route';

const ORIGIN = 'http://127.0.0.1:3001';
const ctx = (id = 'visit-1') => ({ params: Promise.resolve({ id }) });
const billCtx = (billId = 'bill-1') => ({ params: Promise.resolve({ billId }) });

function write(method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/staff/opd/x`, {
    method,
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'x-hospigo-branch': 'branch-1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  callStaffApiMock.mockReset();
  hasAccessCookie = true;
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
});

describe('tests and refunds GET routes', () => {
  it.each([
    ['pending tests', () => getPending(), '/opd/investigations/pending', undefined],
    [
      'visit tests',
      () => getVisitTests(new Request(ORIGIN), ctx('v/1')),
      '/opd/visits/v%2F1/investigations',
      undefined,
    ],
    [
      'one refund request',
      () => getRefund(new Request(ORIGIN), ctx('r/1')),
      '/opd/refund-requests/r%2F1',
      undefined,
    ],
  ])('%s passes the right path through and never caches', async (_name, call, path, query) => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(callStaffApiMock).toHaveBeenCalledWith(path, { method: 'GET', query, body: undefined });
  });

  it('tests search forwards only q and limit', async () => {
    await getTests(new Request(`${ORIGIN}/x?q=Blood&limit=5&evil=1`));
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/investigations/tests', {
      method: 'GET',
      query: { q: 'Blood', limit: '5' },
      body: undefined,
    });
  });

  it('the refund list forwards only status, page and pageSize', async () => {
    await getRefunds(
      new Request(`${ORIGIN}/x?status=REQUESTED&page=2&pageSize=20&evil=1&tenant=t`),
    );
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/refund-requests', {
      method: 'GET',
      query: { status: 'REQUESTED', page: '2', pageSize: '20' },
      body: undefined,
    });
    callStaffApiMock.mockClear();
    await getRefunds(new Request(`${ORIGIN}/x`));
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/refund-requests', {
      method: 'GET',
      query: {},
      body: undefined,
    });
  });

  it('without the access cookie it is a JSON 401, never a redirect', async () => {
    hasAccessCookie = false;
    for (const res of [
      await getPending(),
      await getTests(new Request(ORIGIN)),
      await getRefunds(new Request(ORIGIN)),
      await getRefund(new Request(ORIGIN), ctx()),
      await getVisitTests(new Request(ORIGIN), ctx()),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('a 403 and a 404 from the API stay 403 and 404 with their code', async () => {
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 403, body: { code: 'FORBIDDEN' } });
    const forbidden = await getPending();
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe('FORBIDDEN');
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      body: { code: 'REFUND_REQUEST_NOT_FOUND' },
    });
    const missing = await getRefund(new Request(ORIGIN), ctx());
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('REFUND_REQUEST_NOT_FOUND');
  });
});

describe.each([
  [
    'doctor sets tests',
    putVisitTests,
    'PUT',
    ctx,
    '/opd/visits/a%2Fb/investigations',
    { chargeItemIds: ['t1'] },
  ],
  [
    'bill tests',
    postBill,
    'POST',
    ctx,
    '/opd/visits/a%2Fb/investigation-bills',
    { idempotencyKey: 'k-12345678', orderIds: ['o1'] },
  ],
  [
    'cancel request',
    postCancel,
    'POST',
    ctx,
    '/opd/visits/a%2Fb/cancel-requests',
    { reason: 'left', idempotencyKey: 'k-12345678' },
  ],
  [
    'refund request',
    postRefund,
    'POST',
    billCtx,
    '/opd/bills/a%2Fb/refund-requests',
    { amountPaise: 100, reason: 'wrong', idempotencyKey: 'k-12345678' },
  ],
  ['approve', postApprove, 'POST', ctx, '/opd/refund-requests/a%2Fb/approve', { note: 'ok' }],
  ['reject', postReject, 'POST', ctx, '/opd/refund-requests/a%2Fb/reject', { note: 'no' }],
] as const)('write route: %s', (_name, handler, method, makeCtx, path, body) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (request: Request) => (handler as any)(request, (makeCtx as any)('a/b'));

  it('forwards the body untouched to the right API path (id encoded)', async () => {
    const res = await call(write(method, body));
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(path, { method, query: undefined, body });
  });

  it('refuses a missing or foreign Origin and a non-JSON body before anything else', async () => {
    const noOrigin = new Request(`${ORIGIN}/x`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect((await call(noOrigin)).status).toBe(403);
    expect((await call(write(method, body, { Origin: 'https://evil.example' }))).status).toBe(403);
    const text = new Request(`${ORIGIN}/x`, {
      method,
      headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
      body: 'x',
    });
    expect((await call(text)).status).toBe(415);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object', async () => {
    for (const bad of [[1, 2], 'text', 5, null]) {
      expect((await call(write(method, bad))).status).toBe(400);
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a stale-tab write and a missing cookie', async () => {
    expect((await call(write(method, body, { 'x-hospigo-branch': 'branch-2' }))).status).toBe(409);
    hasAccessCookie = false;
    expect((await call(write(method, body))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the helpful facts of a refusal on, and nothing else', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 409,
      body: {
        code: 'REFUND_EXCEEDS_REFUNDABLE',
        refundablePaise: 5000,
        pendingPaise: 1000,
        paymentModeCode: 'UPI',
        status: 'REJECTED',
        series: 'REFUND',
        max: 30,
        stack: 'secret',
        token: 'x',
        refundablePaiseText: 'not a number',
      },
    });
    const res = await call(write(method, body));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'REFUND_EXCEEDS_REFUNDABLE',
      paymentModeCode: 'UPI',
      status: 'REJECTED',
      series: 'REFUND',
      refundablePaise: 5000,
      pendingPaise: 1000,
      max: 30,
    });
  });

  it('ignores facts of the wrong type', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 409,
      body: { code: 'X', refundablePaise: '5000', pendingPaise: 1.5, paymentModeCode: { a: 1 } },
    });
    const res = await call(write(method, body));
    expect(await res.json()).toEqual({ code: 'X' });
  });
});
