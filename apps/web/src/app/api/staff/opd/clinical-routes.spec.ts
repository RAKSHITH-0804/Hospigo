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

import { GET as getQueue } from './queue/route';
import { GET as getVitalsFields } from './vitals-fields/route';
import { GET as getMedicines } from './medicines/route';
import { POST as postStart } from './visits/[id]/start/route';
import { POST as postComplete } from './visits/[id]/complete/route';
import { PUT as putPrescription } from './visits/[id]/prescription/route';
import { GET as getConsultation, PUT as putConsultation } from './visits/[id]/consultation/route';
import { POST as postAddendum } from './visits/[id]/consultation/addenda/route';
import { GET as getVitals, POST as postVitals } from './visits/[id]/vitals/route';

const ORIGIN = 'http://127.0.0.1:3001';
const ctx = (id = 'visit-1') => ({ params: Promise.resolve({ id }) });

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

describe('clinical GET routes', () => {
  it.each([
    ['queue', () => getQueue(), '/opd/queue'],
    ['vitals fields', () => getVitalsFields(), '/opd/vitals-fields'],
    [
      'consultation',
      () => getConsultation(new Request(ORIGIN), ctx('visit/1')),
      '/opd/visits/visit%2F1/consultation',
    ],
    ['visit vitals', () => getVitals(new Request(ORIGIN), ctx()), '/opd/visits/visit-1/vitals'],
  ])('%s passes the right path through and never caches', async (_name, call, path) => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(callStaffApiMock).toHaveBeenCalledWith(path, {
      method: 'GET',
      query: undefined,
      body: undefined,
    });
  });

  it('medicine search forwards only q and limit', async () => {
    await getMedicines(new Request(`${ORIGIN}/api/staff/opd/medicines?q=Para&limit=5&evil=1`));
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/medicines', {
      method: 'GET',
      query: { q: 'Para', limit: '5' },
      body: undefined,
    });
    callStaffApiMock.mockClear();
    await getMedicines(new Request(`${ORIGIN}/api/staff/opd/medicines`));
    expect(callStaffApiMock).toHaveBeenCalledWith('/opd/medicines', {
      method: 'GET',
      query: {},
      body: undefined,
    });
  });

  it('without the access cookie it is a JSON 401, never a redirect', async () => {
    hasAccessCookie = false;
    for (const res of [await getQueue(), await getConsultation(new Request(ORIGIN), ctx())]) {
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('UNAUTHORIZED');
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('a 403 from the API is a JSON 403 and a not-found stays 404', async () => {
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 403, body: { code: 'FORBIDDEN' } });
    const forbidden = await getQueue();
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe('FORBIDDEN');
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      body: { code: 'VISIT_NOT_FOUND' },
    });
    const missing = await getConsultation(new Request(ORIGIN), ctx());
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('VISIT_NOT_FOUND');
  });
});

describe.each([
  ['start', postStart, 'POST', '/start', {}],
  ['complete', postComplete, 'POST', '/complete', {}],
  ['prescription', putPrescription, 'PUT', '/prescription', { items: [] }],
  ['note', putConsultation, 'PUT', '/consultation', { diagnosis: 'x' }],
  ['addendum', postAddendum, 'POST', '/consultation/addenda', { text: 'a', reason: 'b' }],
  ['vitals', postVitals, 'POST', '/vitals', { readings: [{ fieldCode: 'pulse', value: 72 }] }],
] as const)('clinical write route: %s', (_name, handler, method, tail, body) => {
  it('forwards the body untouched to the visit path (id encoded)', async () => {
    const res = await handler(write(method, body), ctx('a/b'));
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(`/opd/visits/a%2Fb${tail}`, {
      method,
      query: undefined,
      body,
    });
  });

  it('refuses a missing or foreign Origin and a non-JSON body before anything else', async () => {
    const noOrigin = new Request(`${ORIGIN}/x`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect((await handler(noOrigin, ctx())).status).toBe(403);
    expect(
      (await handler(write(method, body, { Origin: 'https://evil.example' }), ctx())).status,
    ).toBe(403);
    const text = new Request(`${ORIGIN}/x`, {
      method,
      headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
      body: 'x',
    });
    expect((await handler(text, ctx())).status).toBe(415);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object', async () => {
    for (const bad of [[1, 2], 'text', 5, null]) {
      const res = await handler(write(method, bad), ctx());
      expect(res.status).toBe(400);
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a stale-tab write (another branch is active) and a missing cookie', async () => {
    const stale = await handler(write(method, body, { 'x-hospigo-branch': 'branch-2' }), ctx());
    expect(stale.status).toBe(409);
    hasAccessCookie = false;
    const loggedOut = await handler(write(method, body), ctx());
    expect(loggedOut.status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the API refusal on with the helpful facts (field code, row index), no redirect', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: {
        code: 'VITALS_VALUE_INVALID',
        fieldCode: 'pulse',
        index: 2,
        stack: 'secret',
        token: 'x',
      },
    });
    const res = await handler(write(method, body), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'VITALS_VALUE_INVALID',
      fieldCode: 'pulse',
      index: 2,
    });
  });
});
