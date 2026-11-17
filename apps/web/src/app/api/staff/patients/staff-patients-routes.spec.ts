/**
 * @jest-environment node
 */

const ACCESS_COOKIE = `h.${Buffer.from(JSON.stringify({ branchId: 'branch-1' })).toString('base64url')}.s`;
const callStaffApiMock = jest.fn();
const authMeMock = jest.fn();
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

// The proxy must never look the session up; this mock fails the test if it does.
jest.mock('@/lib/auth/session', () => ({
  getSession: (...args: unknown[]) => authMeMock(...args),
}));

import { GET as getFormConfig } from './form-config/route';
import { GET as getDetail, PATCH as patchDetail } from './[id]/route';
import { GET as getPatients, POST as postPatient } from './route';
import { GET as getUhid, PUT as putUhid } from './uhid/start-number/route';

const ORIGIN = 'http://127.0.0.1:3001';

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
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

const idContext = { params: Promise.resolve({ id: 'p 1' }) };

describe('staff patients routes', () => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    authMeMock.mockReset();
    hasAccessCookie = true;
    callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
  });

  describe('GET /form-config', () => {
    it('proxies without any session lookup', async () => {
      const res = await getFormConfig();
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients/form-config', {
        method: 'GET',
        query: undefined,
        body: undefined,
      });
    });

    it('returns JSON 401 without the access cookie and never calls the API or /auth/me', async () => {
      hasAccessCookie = false;
      const res = await getFormConfig();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: 'UNAUTHORIZED' });
      expect(callStaffApiMock).not.toHaveBeenCalled();
      expect(authMeMock).not.toHaveBeenCalled();
    });

    it('maps an upstream 403 to FORBIDDEN (the API decides permissions)', async () => {
      callStaffApiMock.mockResolvedValue({
        ok: false,
        status: 403,
        body: { message: 'Forbidden' },
      });
      const res = await getFormConfig();
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN');
      expect(authMeMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /', () => {
    it('forwards sort, page, pageSize and one filter (no token in query)', async () => {
      const res = await getPatients(
        new Request(
          `${ORIGIN}/api/staff/patients?sort=newest&page=2&pageSize=20&name=Mock&evil=1&token=nope`,
        ),
      );
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients', {
        method: 'GET',
        query: { sort: 'newest', page: '2', pageSize: '20', name: 'Mock' },
        body: undefined,
      });
      const calledQuery = callStaffApiMock.mock.calls[0]?.[1]?.query as Record<string, string>;
      expect(calledQuery).not.toHaveProperty('token');
      expect(calledQuery).not.toHaveProperty('evil');
    });

    it('forwards q', async () => {
      await getPatients(new Request(`${ORIGIN}/api/staff/patients?q=ani%20k&sort=oldest`));
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients', {
        method: 'GET',
        query: { q: 'ani k', sort: 'oldest' },
        body: undefined,
      });
    });

    it('maps an upstream 403 to FORBIDDEN', async () => {
      callStaffApiMock.mockResolvedValue({ ok: false, status: 403 });
      const res = await getPatients(new Request(`${ORIGIN}/api/staff/patients`));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /', () => {
    it('forwards the body', async () => {
      const body = { name: 'Mock Alpha', confirmDuplicate: true };
      const res = await postPatient(jsonRequest(`${ORIGIN}/api/staff/patients`, 'POST', body));
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients', {
        method: 'POST',
        query: undefined,
        body,
      });
    });

    it('maps an upstream 403 (read-only user) to FORBIDDEN', async () => {
      callStaffApiMock.mockResolvedValue({ ok: false, status: 403 });
      const res = await postPatient(
        jsonRequest(`${ORIGIN}/api/staff/patients`, 'POST', { name: 'Mock Alpha' }),
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'FORBIDDEN' });
    });

    it('returns the duplicate matches on 409 and drops other upstream fields', async () => {
      callStaffApiMock.mockResolvedValue({
        ok: false,
        status: 409,
        body: {
          statusCode: 409,
          code: 'POSSIBLE_DUPLICATE',
          matches: [{ id: 'p1', uhid: 'NREG0001', name: 'Mock Alpha' }],
          accessToken: 'should-not-appear',
        },
      });
      const res = await postPatient(
        jsonRequest(`${ORIGIN}/api/staff/patients`, 'POST', { name: 'Mock Alpha' }),
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: 'POSSIBLE_DUPLICATE',
        matches: [{ id: 'p1', uhid: 'NREG0001', name: 'Mock Alpha' }],
      });
    });

    it('enforces Origin and JSON content type before touching the API', async () => {
      const noOrigin = await postPatient(
        new Request(`${ORIGIN}/api/staff/patients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      );
      expect(noOrigin.status).toBe(403);

      const wrongType = await postPatient(
        new Request(`${ORIGIN}/api/staff/patients`, {
          method: 'POST',
          headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
          body: '{}',
        }),
      );
      expect(wrongType.status).toBe(415);
      expect(callStaffApiMock).not.toHaveBeenCalled();
    });
  });

  describe('GET and PATCH /:id', () => {
    it('GET encodes the id', async () => {
      const res = await getDetail(new Request(`${ORIGIN}/api/staff/patients/p%201`), idContext);
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients/p%201', {
        method: 'GET',
        query: undefined,
        body: undefined,
      });
    });

    it('PATCH returns upstream { id }', async () => {
      callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { id: 'p 1' } });
      const res = await patchDetail(
        jsonRequest(`${ORIGIN}/api/staff/patients/p%201`, 'PATCH', { name: 'New' }),
        idContext,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'p 1' });
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients/p%201', {
        method: 'PATCH',
        query: undefined,
        body: { name: 'New' },
      });
      callStaffApiMock.mockResolvedValue({ ok: false, status: 403 });
      const denied = await patchDetail(
        jsonRequest(`${ORIGIN}/api/staff/patients/p%201`, 'PATCH', { name: 'New' }),
        idContext,
      );
      expect(denied.status).toBe(403);
    });
  });

  describe('GET and PUT /uhid/start-number', () => {
    it('GET proxies', async () => {
      const res = await getUhid();
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients/uhid/start-number', {
        method: 'GET',
        query: undefined,
        body: undefined,
      });
    });

    it('PUT forwards the body', async () => {
      const body = { startNumber: 5000, reason: 'Skip imported block' };
      const res = await putUhid(
        jsonRequest(`${ORIGIN}/api/staff/patients/uhid/start-number`, 'PUT', body),
      );
      expect(res.status).toBe(200);
      expect(callStaffApiMock).toHaveBeenCalledWith('/patients/uhid/start-number', {
        method: 'PUT',
        query: undefined,
        body,
      });
      callStaffApiMock.mockResolvedValue({ ok: false, status: 403 });
      const denied = await putUhid(
        jsonRequest(`${ORIGIN}/api/staff/patients/uhid/start-number`, 'PUT', body),
      );
      expect(denied.status).toBe(403);
    });
  });
});
