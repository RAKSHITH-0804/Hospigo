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

import { GET as getView } from './[id]/availability/route';
import { PUT as putSwitch } from './[id]/availability/switch/route';
import { PUT as putTimings } from './[id]/availability/timings/[branchId]/route';
import { POST as postLeave } from './[id]/availability/leave/route';
import { POST as postRemove } from './[id]/availability/leave/[leaveId]/remove/route';

const ORIGIN = 'http://127.0.0.1:3001';
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;

function write(method: 'PUT' | 'POST', body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/staff/opd/doctors/d1/availability/x`, {
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

describe('availability route handlers', () => {
  it('GET passes the encoded doctor id on and answers 401 without the cookie', async () => {
    const res = await getView(new Request(`${ORIGIN}/x`), ctx({ id: 'a/b' }));
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/opd/doctors/a%2Fb/availability', {
      method: 'GET',
      query: undefined,
    });
    callStaffApiMock.mockClear();
    hasAccessCookie = false;
    expect((await getView(new Request(`${ORIGIN}/x`), ctx({ id: 'd1' }))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('every write goes to the right API path with its body', async () => {
    await putSwitch(write('PUT', { availabilityOn: false }), ctx({ id: 'd1' }));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/opd/doctors/d1/availability/switch',
      expect.objectContaining({ method: 'PUT', body: { availabilityOn: false } }),
    );
    await putTimings(write('PUT', { slots: [] }), ctx({ id: 'd1', branchId: 'b/1' }));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/opd/doctors/d1/availability/timings/b%2F1',
      expect.objectContaining({ method: 'PUT', body: { slots: [] } }),
    );
    await postLeave(
      write('POST', { fromDate: '2026-12-01', toDate: '2026-12-02' }),
      ctx({ id: 'd1' }),
    );
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/opd/doctors/d1/availability/leave',
      expect.objectContaining({ method: 'POST' }),
    );
    await postRemove(write('POST', {}), ctx({ id: 'd1', leaveId: 'l1' }));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/opd/doctors/d1/availability/leave/l1/remove',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refuses a foreign Origin (403), a stale tab (409) and a body that is not an object (400) before the API', async () => {
    const c = ctx({ id: 'd1' });
    expect((await putSwitch(write('PUT', {}, { Origin: 'https://evil.example' }), c)).status).toBe(
      403,
    );
    const stale = await putSwitch(write('PUT', {}, { 'x-hospigo-branch': 'branch-2' }), c);
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('BRANCH_CHANGED');
    expect((await putSwitch(write('PUT', [1]), c)).status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the refusal code, field and reason on and nothing else', async () => {
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      body: { code: 'AVAILABILITY_INVALID', field: 'slots', reason: 'OVERLAP', secret: 'x' },
    });
    const res = await putTimings(write('PUT', { slots: [] }), ctx({ id: 'd1', branchId: 'b1' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'AVAILABILITY_INVALID',
      field: 'slots',
      reason: 'OVERLAP',
    });
  });
});
