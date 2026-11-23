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

import { GET as getList } from './route';
import { GET as getHistory } from './history/route';
import { POST as postItem } from './items/[id]/route';
import { POST as postFee } from './doctor-fees/route';

const ORIGIN = 'http://127.0.0.1:3001';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
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

describe('GET /api/staff/opd/prices and /history', () => {
  it('forwards only the known query values to the API', async () => {
    const res = await getList(
      new Request(`${ORIGIN}/api/staff/opd/prices?q=xray&kind=INVESTIGATION&page=2&evil=1`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/prices', {
      method: 'GET',
      query: { q: 'xray', kind: 'INVESTIGATION', page: '2' },
    });
    await getHistory(
      new Request(`${ORIGIN}/api/staff/opd/prices/history?doctorProfileId=d1&visitType=NEW&x=1`),
    );
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/opd/prices/history', {
      method: 'GET',
      query: { doctorProfileId: 'd1', visitType: 'NEW' },
    });
  });

  it('returns JSON 401 without the cookie and never calls the API', async () => {
    hasAccessCookie = false;
    expect((await getList(new Request(`${ORIGIN}/api/staff/opd/prices`))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes a permission refusal on as FORBIDDEN and an outage as UNAVAILABLE', async () => {
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 403, data: {} });
    const refused = await getList(new Request(`${ORIGIN}/api/staff/opd/prices`));
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe('FORBIDDEN');
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 503, data: {} });
    expect((await getList(new Request(`${ORIGIN}/api/staff/opd/prices`))).status).toBe(503);
  });
});

describe.each([
  [
    'item',
    (b: unknown, h?: Record<string, string>) =>
      postItem(post(`${ORIGIN}/api/staff/opd/prices/items/item%2F1`, b, h), ctx('item/1')),
    '/opd/prices/items/item%2F1',
    { amountPaise: 30_000, effectiveFrom: '2026-12-01' },
  ],
  [
    'doctor fee',
    (b: unknown, h?: Record<string, string>) =>
      postFee(post(`${ORIGIN}/api/staff/opd/prices/doctor-fees`, b, h)),
    '/opd/prices/doctor-fees',
    { doctorProfileId: 'd1', visitType: 'NEW', amountPaise: 50_000 },
  ],
] as const)('POST price change (%s)', (_name, call, apiPath, body) => {
  it('forwards the body untouched to the API path and returns its answer', async () => {
    const res = await call(body);
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(apiPath, {
      method: 'POST',
      query: undefined,
      body,
    });
  });

  it('refuses a missing or foreign Origin, a stale tab and a body that is not an object', async () => {
    expect((await call(body, { Origin: 'https://evil.example' })).status).toBe(403);
    const stale = await call(body, { 'x-hospigo-branch': 'branch-2' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('BRANCH_CHANGED');
    expect((await call([1, 2])).status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('returns JSON 401 without the cookie', async () => {
    hasAccessCookie = false;
    expect((await call(body)).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the price refusal on with its field and reason, nothing else', async () => {
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      body: { code: 'PRICE_INVALID', field: 'effectiveFrom', reason: 'DATE_IN_PAST', secret: 'x' },
    });
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'PRICE_INVALID',
      field: 'effectiveFrom',
      reason: 'DATE_IN_PAST',
    });
  });
});
