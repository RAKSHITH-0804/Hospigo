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

import { GET as getFields } from './route';
import { POST as postReferenceSet } from './reference-set/route';

const ORIGIN = 'http://127.0.0.1:3001';

function post(headers: Record<string, string> = {}, body: unknown = {}) {
  return new Request(`${ORIGIN}/api/staff/settings/patient-fields/reference-set`, {
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

describe('registration fields: reference set routes', () => {
  it('the fields are read again from the API and need the cookie (JSON 401 otherwise)', async () => {
    expect((await getFields()).status).toBe(200);
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/settings/patient-fields', {
      method: 'GET',
      query: undefined,
    });
    callStaffApiMock.mockClear();
    hasAccessCookie = false;
    expect((await getFields()).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('adding the set goes to the API path', async () => {
    expect((await postReferenceSet(post())).status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/settings/patient-fields/reference-set',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refuses a foreign Origin (403), a stale tab (409) and a body that is not an object (400) before the API', async () => {
    expect((await postReferenceSet(post({ Origin: 'https://evil.example' }))).status).toBe(403);
    expect((await postReferenceSet(post({ 'x-hospigo-branch': 'branch-2' }))).status).toBe(409);
    expect((await postReferenceSet(post({}, [1]))).status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
