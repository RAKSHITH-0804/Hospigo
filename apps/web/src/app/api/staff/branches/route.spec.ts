/**
 * @jest-environment node
 */

const callStaffApiMock = jest.fn();
let hasAccessCookie = true;

jest.mock('@/lib/auth/staff-api', () => ({
  callStaffApi: (...args: unknown[]) => callStaffApiMock(...args),
}));
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      hasAccessCookie && name === 'hospigo_access' ? { value: 'cookie-value' } : undefined,
  }),
}));

import { GET } from './route';

describe('GET /api/staff/branches', () => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    hasAccessCookie = true;
  });

  it('proxies the switchable-branches list', async () => {
    const list = [{ id: 'b1', name: 'Main', isMain: true, isCurrent: true }];
    callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: list });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(list);
    expect(callStaffApiMock).toHaveBeenCalledWith('/auth/switchable-branches', {
      method: 'GET',
      query: undefined,
      body: undefined,
    });
  });

  it('maps an upstream 403 (not a hospital-wide user) to FORBIDDEN', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: {} });
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('returns JSON 401 without a cookie and never calls the API', async () => {
    hasAccessCookie = false;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
