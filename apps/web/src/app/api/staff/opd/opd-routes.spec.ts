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

import { GET as getDoctors } from './doctors/route';
import { POST as postVisit } from './visits/route';
import { POST as postPreview } from './visits/preview/route';

const ORIGIN = 'http://127.0.0.1:3001';

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
) {
  return new Request(url, {
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

const choice = { patientId: 'p1', doctorProfileId: 'd1', visitType: 'NEW' };
const createBody = { ...choice, idempotencyKey: 'KEY-12345678', expectedTotalPaise: 60_000 };

describe.each([
  ['preview', postPreview, `${ORIGIN}/api/staff/opd/visits/preview`, '/opd/visits/preview', choice],
  ['create', postVisit, `${ORIGIN}/api/staff/opd/visits`, '/opd/visits', createBody],
] as const)('POST /api/staff/opd/visits (%s)', (_name, handler, url, apiPath, body) => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    hasAccessCookie = true;
    callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
  });

  it('forwards the body untouched to the API path and returns its answer', async () => {
    const res = await handler(jsonRequest(url, body));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(callStaffApiMock).toHaveBeenCalledWith(apiPath, {
      method: 'POST',
      query: undefined,
      body,
    });
  });

  it('refuses a missing or foreign Origin and a non-JSON body before anything else', async () => {
    const noOrigin = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hospigo-branch': 'branch-1' },
      body: JSON.stringify(body),
    });
    expect((await handler(noOrigin)).status).toBe(403);
    expect((await handler(jsonRequest(url, body, { Origin: 'https://evil.example' }))).status).toBe(
      403,
    );
    const text = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'x-hospigo-branch': 'branch-1' },
      body: 'x',
    });
    expect((await handler(text)).status).toBe(415);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a body that is not an object', async () => {
    const res = await handler(jsonRequest(url, 'text'));
    expect(res.status).toBe(400);
    const nul = await handler(jsonRequest(url, null));
    expect(nul.status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('stale-tab guard: a missing or different branch is 409 BRANCH_CHANGED and the API is not called', async () => {
    const missing = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const wrong = jsonRequest(url, body, { 'x-hospigo-branch': 'branch-2' });
    for (const request of [missing, wrong]) {
      const res = await handler(request);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ code: 'BRANCH_CHANGED' });
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('returns JSON 401 without the cookie and never calls the API', async () => {
    hasAccessCookie = false;
    const res = await handler(jsonRequest(url, body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('maps an upstream 401 and 403 and passes the visit refusals through', async () => {
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 401, body: {} });
    expect((await (await handler(jsonRequest(url, body))).json()).code).toBe('SESSION_EXPIRED');
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 403, body: {} });
    const forbidden = await handler(jsonRequest(url, body));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe('FORBIDDEN');
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      body: { statusCode: 400, code: 'DOCTOR_UNAVAILABLE', reason: 'SWITCH_OFF' },
    });
    const refused = await handler(jsonRequest(url, body));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      code: 'DOCTOR_UNAVAILABLE',
      reason: 'SWITCH_OFF',
    });
  });

  it('PRICE_CHANGED carries the new total, and nothing else from the upstream body', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 409,
      body: {
        code: 'PRICE_CHANGED',
        totalPaise: 25_000,
        expectedTotalPaise: 20_000,
        internal: 'drop-me',
        stack: 'drop-me-too',
      },
    });
    const res = await handler(jsonRequest(url, body));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({ code: 'PRICE_CHANGED', totalPaise: 25_000 });
    expect(JSON.stringify(json)).not.toContain('drop-me');
  });

  it('an outage is UNAVAILABLE', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 503 });
    const res = await handler(jsonRequest(url, body));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'UNAVAILABLE' });
  });
});

describe('GET /api/staff/opd/doctors', () => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    hasAccessCookie = true;
  });

  it('proxies the doctor list', async () => {
    callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
    const res = await getDoctors();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/doctors', {
      method: 'GET',
      query: undefined,
      body: undefined,
    });
  });

  it('401 without a cookie, 403 from the API is FORBIDDEN', async () => {
    hasAccessCookie = false;
    expect((await getDoctors()).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
    hasAccessCookie = true;
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: {} });
    const res = await getDoctors();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });
});
