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

import { GET as getSeries } from './number-series/route';
import { PUT as putSeries } from './number-series/[series]/route';
import { PUT as putStart } from './number-series/[series]/start-number/route';

const ORIGIN = 'http://127.0.0.1:3001';
const ctx = (series: string) => ({ params: Promise.resolve({ series }) });

function put(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/staff/settings/number-series/BILL`, {
    method: 'PUT',
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

describe('number series route handlers', () => {
  it('the list is read from the API and needs the cookie (JSON 401 otherwise)', async () => {
    expect((await getSeries()).status).toBe(200);
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/settings/number-series', {
      method: 'GET',
      query: undefined,
    });
    callStaffApiMock.mockClear();
    hasAccessCookie = false;
    expect((await getSeries()).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('a format change and a start number go to their API paths with the series encoded', async () => {
    await putSeries(put({ prefix: 'INV' }), ctx('BILL'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/number-series/BILL',
      expect.objectContaining({ method: 'PUT', body: { prefix: 'INV' } }),
    );
    await putStart(put({ startNumber: 10, reason: 'x' }), ctx('RE/CEIPT'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/number-series/RE%2FCEIPT/start-number',
      expect.objectContaining({ method: 'PUT', body: { startNumber: 10, reason: 'x' } }),
    );
  });

  it('refuses a foreign Origin (403), a stale tab (409) and a body that is not an object (400) before the API', async () => {
    expect((await putSeries(put({}, { Origin: 'https://evil.example' }), ctx('BILL'))).status).toBe(
      403,
    );
    const stale = await putStart(put({}, { 'x-hospigo-branch': 'branch-2' }), ctx('BILL'));
    expect(stale.status).toBe(409);
    expect((await putSeries(put([1]), ctx('BILL'))).status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the refusal code and reason on and nothing else', async () => {
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { code: 'MASTER_CONFLICT', reason: 'LOCKED_AFTER_USE', secret: 'x' },
    });
    const res = await putSeries(put({ resetRule: 'NEVER' }), ctx('BILL'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'MASTER_CONFLICT', reason: 'LOCKED_AFTER_USE' });
  });
});
