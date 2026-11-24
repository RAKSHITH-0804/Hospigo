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

import { GET as getModes, POST as postMode } from './payment-modes/route';
import { PUT as putMode } from './payment-modes/[id]/route';
import { GET as getFields, POST as postField } from './vitals-fields/route';
import { PUT as putField } from './vitals-fields/[id]/route';
import { POST as postReorder } from './vitals-fields/reorder/route';

const ORIGIN = 'http://127.0.0.1:3001';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function write(method: 'PUT' | 'POST', body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/staff/settings/x`, {
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

describe('masters route handlers', () => {
  it('the lists are read from the right API path and need the cookie (JSON 401 otherwise)', async () => {
    expect((await getModes()).status).toBe(200);
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/settings/payment-modes', {
      method: 'GET',
      query: undefined,
    });
    expect((await getFields()).status).toBe(200);
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/settings/vitals-fields', {
      method: 'GET',
      query: undefined,
    });
    callStaffApiMock.mockClear();
    hasAccessCookie = false;
    expect((await getModes()).status).toBe(401);
    expect((await getFields()).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('every write goes to the right API path with its body, and the id is encoded', async () => {
    await postMode(write('POST', { code: 'NEFT' }));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/payment-modes',
      expect.objectContaining({ method: 'POST', body: { code: 'NEFT' } }),
    );
    await putMode(write('PUT', { active: false }), ctx('a/b'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/payment-modes/a%2Fb',
      expect.objectContaining({ method: 'PUT', body: { active: false } }),
    );
    await postField(write('POST', { code: 'pulse' }));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/vitals-fields',
      expect.objectContaining({ method: 'POST' }),
    );
    await putField(write('PUT', { name: 'X' }), ctx('f1'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/vitals-fields/f1',
      expect.objectContaining({ method: 'PUT' }),
    );
    await postReorder(write('POST', { ids: ['a'] }));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/vitals-fields/reorder',
      expect.objectContaining({ method: 'POST', body: { ids: ['a'] } }),
    );
  });

  it('refuses a foreign Origin (403), a stale tab (409) and a body that is not an object (400) before the API', async () => {
    expect((await postMode(write('POST', {}, { Origin: 'https://evil.example' }))).status).toBe(
      403,
    );
    const stale = await putField(write('PUT', {}, { 'x-hospigo-branch': 'branch-2' }), ctx('f1'));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('BRANCH_CHANGED');
    expect((await postReorder(write('POST', [1]))).status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the refusal code, field and reason on and nothing else', async () => {
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { code: 'MASTER_CONFLICT', reason: 'CODE_USED', secret: 'x' },
    });
    const res = await postMode(write('POST', { code: 'CASH' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'MASTER_CONFLICT', reason: 'CODE_USED' });
  });
});
