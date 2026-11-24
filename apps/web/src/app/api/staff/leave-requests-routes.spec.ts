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

import { GET as getMine, POST as postMine } from './doctor-profiles/me/leave-requests/route';
import { POST as postCancel } from './doctor-profiles/me/leave-requests/[id]/cancel/route';
import { GET as getAdmin } from './opd/leave-requests/route';
import { POST as postApprove } from './opd/leave-requests/[id]/approve/route';
import { POST as postReject } from './opd/leave-requests/[id]/reject/route';

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

type Case = {
  name: string;
  call: (req: Request) => Promise<Response>;
  path: string;
  apiPath: string;
};

const WRITES: Case[] = [
  {
    name: 'ask for leave',
    call: (r) => postMine(r),
    path: 'doctor-profiles/me/leave-requests',
    apiPath: '/doctor-profiles/me/leave-requests',
  },
  {
    name: 'cancel a request',
    call: (r) => postCancel(r, idOnly('r 1')),
    path: 'doctor-profiles/me/leave-requests/r%201/cancel',
    apiPath: '/doctor-profiles/me/leave-requests/r%201/cancel',
  },
  {
    name: 'approve',
    call: (r) => postApprove(r, idOnly('r 1')),
    path: 'opd/leave-requests/r%201/approve',
    apiPath: '/opd/leave-requests/r%201/approve',
  },
  {
    name: 'reject',
    call: (r) => postReject(r, idOnly('r 1')),
    path: 'opd/leave-requests/r%201/reject',
    apiPath: '/opd/leave-requests/r%201/reject',
  },
];

beforeEach(() => {
  callStaffApiMock.mockReset();
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { done: true } });
  hasAccessCookie = true;
});

describe.each(WRITES)('$name', ({ call, path, apiPath }) => {
  it('passes the body to the API path and returns its answer', async () => {
    const res = await call(request('POST', path, { a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
    expect(callStaffApiMock).toHaveBeenCalledWith(
      apiPath,
      expect.objectContaining({ method: 'POST', body: { a: 1 } }),
    );
  });

  it('is refused from another origin, without a JSON type, without a login, with a bad body and on a stale branch', async () => {
    expect(
      (await call(request('POST', path, { a: 1 }, { Origin: 'http://evil.test' }))).status,
    ).toBe(403);
    expect(
      (await call(request('POST', path, { a: 1 }, { 'Content-Type': 'text/plain' }))).status,
    ).toBe(415);
    expect((await call(request('POST', path, [1]))).status).toBe(400);
    expect(
      (await call(request('POST', path, { a: 1 }, { 'x-hospigo-branch': 'branch-2' }))).status,
    ).toBe(409);
    hasAccessCookie = false;
    const res = await call(request('POST', path, { a: 1 }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHORIZED');
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});

describe('reading leave requests', () => {
  it('the doctor list is a plain GET of the API path', async () => {
    const res = await getMine();
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/doctor-profiles/me/leave-requests',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('the Admin list passes only status, page and pageSize', async () => {
    await getAdmin(
      request('GET', 'opd/leave-requests?status=ALL&page=2&pageSize=10&doctorProfileId=x&junk=1'),
    );
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/opd/leave-requests',
      expect.objectContaining({
        method: 'GET',
        query: { status: 'ALL', page: '2', pageSize: '10' },
      }),
    );
  });

  it('is refused without a login', async () => {
    hasAccessCookie = false;
    expect((await getMine()).status).toBe(401);
    expect((await getAdmin(request('GET', 'opd/leave-requests'))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
