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

import { PUT as putAccountMe } from './account/me/route';
import { POST as postEmail } from './account/email/[step]/route';
import { POST as postPassword } from './account/password/[step]/route';
import { GET as getPeople, POST as postPeople } from './people/route';
import { PUT as putPerson } from './people/[id]/route';
import { POST as postPersonAction } from './people/[id]/[action]/route';
import { PUT as putCodeFormat } from './people/code-format/route';
import { POST as postRole } from './roles/route';
import { PUT as putRole } from './roles/[id]/route';
import { POST as postRoleAction } from './roles/[id]/[action]/route';

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
const idAction = (id: string, action: string) => ({ params: Promise.resolve({ id, action }) });
const step = (value: string) => ({ params: Promise.resolve({ step: value }) });

type Case = {
  name: string;
  call: (req: Request) => Promise<Response>;
  method: string;
  path: string;
  apiPath: string;
};

const WRITES: Case[] = [
  {
    name: 'add staff',
    call: (r) => postPeople(r),
    method: 'POST',
    path: 'people',
    apiPath: '/staff',
  },
  {
    name: 'change staff',
    call: (r) => putPerson(r, idOnly('u 1')),
    method: 'PUT',
    path: 'people/u%201',
    apiPath: '/staff/u%201',
  },
  {
    name: 'switch off',
    call: (r) => postPersonAction(r, idAction('u1', 'deactivate')),
    method: 'POST',
    path: 'people/u1/deactivate',
    apiPath: '/staff/u1/deactivate',
  },
  {
    name: 'switch on',
    call: (r) => postPersonAction(r, idAction('u1', 'reactivate')),
    method: 'POST',
    path: 'people/u1/reactivate',
    apiPath: '/staff/u1/reactivate',
  },
  {
    name: 'resend invite',
    call: (r) => postPersonAction(r, idAction('u1', 'resend-invite')),
    method: 'POST',
    path: 'people/u1/resend-invite',
    apiPath: '/staff/u1/resend-invite',
  },
  {
    name: 'code format',
    call: (r) => putCodeFormat(r),
    method: 'PUT',
    path: 'people/code-format',
    apiPath: '/staff/code-format',
  },
  { name: 'add role', call: (r) => postRole(r), method: 'POST', path: 'roles', apiPath: '/roles' },
  {
    name: 'change role',
    call: (r) => putRole(r, idOnly('r1')),
    method: 'PUT',
    path: 'roles/r1',
    apiPath: '/roles/r1',
  },
  {
    name: 'switch a role off',
    call: (r) => postRoleAction(r, idAction('r1', 'deactivate')),
    method: 'POST',
    path: 'roles/r1/deactivate',
    apiPath: '/roles/r1/deactivate',
  },
  {
    name: 'switch a role on',
    call: (r) => postRoleAction(r, idAction('r1', 'reactivate')),
    method: 'POST',
    path: 'roles/r1/reactivate',
    apiPath: '/roles/r1/reactivate',
  },
  {
    name: 'my details',
    call: (r) => putAccountMe(r),
    method: 'PUT',
    path: 'account/me',
    apiPath: '/account/me',
  },
  {
    name: 'email code request',
    call: (r) => postEmail(r, step('request')),
    method: 'POST',
    path: 'account/email/request',
    apiPath: '/account/email/request',
  },
  {
    name: 'email code confirm',
    call: (r) => postEmail(r, step('confirm')),
    method: 'POST',
    path: 'account/email/confirm',
    apiPath: '/account/email/confirm',
  },
  {
    name: 'password code request',
    call: (r) => postPassword(r, step('request')),
    method: 'POST',
    path: 'account/password/request',
    apiPath: '/account/password/request',
  },
  {
    name: 'password code confirm',
    call: (r) => postPassword(r, step('confirm')),
    method: 'POST',
    path: 'account/password/confirm',
    apiPath: '/account/password/confirm',
  },
];

beforeEach(() => {
  callStaffApiMock.mockReset();
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { done: true } });
  hasAccessCookie = true;
});

describe.each(WRITES)('$name', ({ call, method, path, apiPath }) => {
  it('passes the body to the API path and returns its answer', async () => {
    const res = await call(request(method, path, { a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
    expect(callStaffApiMock).toHaveBeenCalledWith(
      apiPath,
      expect.objectContaining({ method, body: { a: 1 } }),
    );
  });

  it('is refused from another origin, without a JSON type, without a login, and with a bad body', async () => {
    expect(
      (await call(request(method, path, { a: 1 }, { Origin: 'http://evil.test' }))).status,
    ).toBe(403);
    expect(
      (await call(request(method, path, { a: 1 }, { 'Content-Type': 'text/plain' }))).status,
    ).toBe(415);
    expect((await call(request(method, path, [1]))).status).toBe(400);
    hasAccessCookie = false;
    const res = await call(request(method, path, { a: 1 }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHORIZED');
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('is refused when another tab switched branch (stale branch header)', async () => {
    const res = await call(request(method, path, { a: 1 }, { 'x-hospigo-branch': 'branch-2' }));
    expect(res.status).toBe(409);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes on the API refusal with its small facts only (never the raw body)', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 429,
      body: { code: 'RATE_LIMITED', retryAfterSec: 42, secret: 'nope', reason: 'X' },
    });
    const res = await call(request(method, path, { a: 1 }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: 'RATE_LIMITED', retryAfterSec: 42, reason: 'X' });
  });
});

describe('the staff list route', () => {
  it('forwards only q, status and page', async () => {
    await getPeople(request('GET', 'people?q=ana&status=ACTIVE&page=2&pageSize=500&x=1'));
    expect(callStaffApiMock).toHaveBeenCalledWith('/staff', {
      method: 'GET',
      query: { q: 'ana', status: 'ACTIVE', page: '2' },
      body: undefined,
    });
  });

  it('asks for the plain list without a query, and answers 401 without a login', async () => {
    await getPeople(request('GET', 'people'));
    expect(callStaffApiMock).toHaveBeenCalledWith('/staff', expect.objectContaining({ query: {} }));
    hasAccessCookie = false;
    expect((await getPeople(request('GET', 'people'))).status).toBe(401);
  });
});

describe('only known actions and steps are passed on', () => {
  it('404 for another person action, role action or code step; the API is not called', async () => {
    const r1 = await postPersonAction(
      request('POST', 'people/u1/delete', {}),
      idAction('u1', 'delete'),
    );
    const r2 = await postRoleAction(
      request('POST', 'roles/r1/resend-invite', {}),
      idAction('r1', 'resend-invite'),
    );
    const r3 = await postEmail(request('POST', 'account/email/x', {}), step('x'));
    const r4 = await postPassword(request('POST', 'account/password/..', {}), step('..'));
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([404, 404, 404, 404]);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('a hostile id is encoded, not used as a path', async () => {
    await putPerson(request('PUT', 'people/x', { a: 1 }), idOnly('../roles/r1'));
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/staff/..%2Froles%2Fr1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
