/**
 * @jest-environment node
 */

const callStaffApiMock = jest.fn();
const authMeMock = jest.fn();
let hasAccessCookie = true;
let accessCookieValue = 'secret-access-token';

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      hasAccessCookie && name === 'hospigo_access' ? { value: accessCookieValue } : undefined,
  }),
}));

jest.mock('./staff-api', () => ({
  callStaffApi: (...args: unknown[]) => callStaffApiMock(...args),
}));

jest.mock('./session', () => ({
  getSession: (...args: unknown[]) => authMeMock(...args),
}));

import { staffRoute } from './staff-route';

const GUARD_HEADER = 'x-hospigo-branch';

/** A JWT-shaped cookie value whose payload names a branch (the web never verifies it). */
function tokenForBranch(branchId: string): string {
  const payload = Buffer.from(JSON.stringify({ branchId })).toString('base64url');
  return `header.${payload}.signature`;
}

function writeRequest(branchId?: string): Request {
  return new Request('http://127.0.0.1:3001/api/staff/x', {
    method: 'POST',
    headers: branchId ? { [GUARD_HEADER]: branchId } : {},
  });
}

describe('staffRoute', () => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    authMeMock.mockReset();
    hasAccessCookie = true;
    accessCookieValue = tokenForBranch('branch-1');
  });

  it('returns JSON 401 without redirect when the access cookie is missing', async () => {
    hasAccessCookie = false;
    const res = await staffRoute({ path: '/patients', query: { name: 'Abc' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('never looks the session up (no /auth/me) and has no permission option', async () => {
    callStaffApiMock.mockResolvedValue({ ok: true, data: {} });
    await staffRoute({ path: '/patients' });
    expect(authMeMock).not.toHaveBeenCalled();
    expect(callStaffApiMock).toHaveBeenCalledTimes(1);
  });

  it('maps upstream 403 to FORBIDDEN', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: { message: 'Forbidden' } });
    const res = await staffRoute({ path: '/patients' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('passthrough success data with no-store', async () => {
    callStaffApiMock.mockResolvedValue({ ok: true, data: { items: [], total: 0 } });
    const res = await staffRoute({
      path: '/patients/search',
      query: { name: 'Abc' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [], total: 0 });
    expect(callStaffApiMock).toHaveBeenCalledWith('/patients/search', {
      method: 'GET',
      query: { name: 'Abc' },
      body: undefined,
    });
  });

  it('forwards 409 body fields code and matches', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 409,
      body: {
        code: 'POSSIBLE_DUPLICATE',
        matches: [{ id: '1', uhid: 'X', name: 'A' }],
        secret: 'drop-me',
      },
    });
    const res = await staffRoute({
      method: 'POST',
      path: '/patients',
      body: { name: 'A' },
      request: writeRequest('branch-1'),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('POSSIBLE_DUPLICATE');
    expect(json.matches).toEqual([{ id: '1', uhid: 'X', name: 'A' }]);
    expect(json).not.toHaveProperty('secret');
    expect(JSON.stringify(json)).not.toMatch(/Bearer|hospigo_access|signature/i);
  });

  it('maps timeout/network 503 to UNAVAILABLE', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 503 });
    const res = await staffRoute({ path: '/patients' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'UNAVAILABLE' });
  });

  it('maps upstream 401 to SESSION_EXPIRED', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 401 });
    const res = await staffRoute({ path: '/patients' });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SESSION_EXPIRED');
  });

  describe('stale-tab branch guard on writes', () => {
    const okUpstream = { ok: true, status: 200, data: { id: 'p1' } };

    it('lets a write through when the page branch equals the session branch', async () => {
      callStaffApiMock.mockResolvedValue(okUpstream);
      const res = await staffRoute({
        method: 'POST',
        path: '/patients',
        body: { name: 'A' },
        request: writeRequest('branch-1'),
      });
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['another branch than the session', 'branch-2'],
      ['no header at all', undefined],
    ])(
      'refuses a write with %s: 409 BRANCH_CHANGED and the API is never called',
      async (_n, hdr) => {
        const res = await staffRoute({
          method: 'POST',
          path: '/patients',
          body: { name: 'A' },
          request: writeRequest(hdr),
        });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ code: 'BRANCH_CHANGED' });
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(callStaffApiMock).not.toHaveBeenCalled();
      },
    );

    it('refuses a write that did not pass its request at all (fail closed)', async () => {
      const res = await staffRoute({ method: 'PATCH', path: '/patients/1', body: { name: 'A' } });
      expect(res.status).toBe(409);
      expect(callStaffApiMock).not.toHaveBeenCalled();
    });

    it('refuses a write when the cookie holds no readable branch', async () => {
      accessCookieValue = 'not-a-jwt';
      const res = await staffRoute({
        method: 'PUT',
        path: '/x',
        body: {},
        request: writeRequest('branch-1'),
      });
      expect(res.status).toBe(409);
      expect(callStaffApiMock).not.toHaveBeenCalled();
    });

    it('does not apply to reads', async () => {
      callStaffApiMock.mockResolvedValue(okUpstream);
      const res = await staffRoute({ method: 'GET', path: '/patients' });
      expect(res.status).toBe(200);
    });
  });
});
