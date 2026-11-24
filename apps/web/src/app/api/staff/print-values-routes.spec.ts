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

import { GET, POST } from './print-values/route';
import { PUT } from './print-values/[id]/route';

const ORIGIN = 'http://127.0.0.1:3001';

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}/api/staff/${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      'x-hospigo-branch': 'branch-1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idOnly = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  callStaffApiMock.mockReset();
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { done: true } });
  hasAccessCookie = true;
});

describe('print values routes', () => {
  it('GET reads the manage view of the API', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/print-values/manage',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('POST passes scope=branch and scope=hospital, and nothing when none is given', async () => {
    for (const [query, api] of [
      ['?scope=branch', '/print-values?scope=branch'],
      ['?scope=hospital', '/print-values?scope=hospital'],
      ['', '/print-values'],
    ] as const) {
      callStaffApiMock.mockClear();
      await POST(request('POST', `print-values${query}`, { key: 'a' }));
      expect(callStaffApiMock).toHaveBeenCalledWith(
        api,
        expect.objectContaining({ method: 'POST', body: { key: 'a' } }),
      );
    }
  });

  it('POST refuses any other scope without calling the API', async () => {
    for (const q of ['?scope=all', '?scope=', '?scope=branch&scope=hospital', '?scope=BRANCH']) {
      const res = await POST(request('POST', `print-values${q}`, { key: 'a' }));
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
      expect((await res.json()).code).toBe('PRINT_SCOPE_INVALID');
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('PUT sends the change to the id of the URL (encoded)', async () => {
    await PUT(request('PUT', 'print-values/v%201', { active: false }), idOnly('v 1'));
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/print-values/v%201',
      expect.objectContaining({ method: 'PUT', body: { active: false } }),
    );
  });

  it('every write is refused from another origin, without a JSON type, with a bad body, on a stale branch and without a login', async () => {
    const calls: Array<(r: Request) => Promise<Response>> = [
      (r) => POST(r),
      (r) => PUT(r, idOnly('v1')),
    ];
    for (const call of calls) {
      const method = call === calls[0] ? 'POST' : 'PUT';
      expect(
        (await call(request(method, 'x', { a: 1 }, { Origin: 'http://evil.test' }))).status,
      ).toBe(403);
      expect(
        (await call(request(method, 'x', { a: 1 }, { 'Content-Type': 'text/plain' }))).status,
      ).toBe(415);
      expect((await call(request(method, 'x', [1]))).status).toBe(400);
      expect(
        (await call(request(method, 'x', { a: 1 }, { 'x-hospigo-branch': 'branch-2' }))).status,
      ).toBe(409);
    }
    hasAccessCookie = false;
    expect((await GET()).status).toBe(401);
    expect((await POST(request('POST', 'x', { a: 1 }))).status).toBe(401);
    expect((await PUT(request('PUT', 'x', { a: 1 }), idOnly('v1'))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
