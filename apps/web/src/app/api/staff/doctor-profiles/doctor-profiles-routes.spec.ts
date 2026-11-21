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

import { PUT as putOne } from './[id]/route';
import { PUT as putMe } from './me/route';

const ORIGIN = 'http://127.0.0.1:3001';

function request(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method = 'PUT',
) {
  return new Request(`${ORIGIN}/api/staff/doctor-profiles/${path}`, {
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
const id = (v: string) => ({ params: Promise.resolve({ id: v }) });

const CASES = [
  {
    name: 'my profile',
    call: (req: Request) => putMe(req),
    path: 'me',
    apiPath: '/doctor-profiles/me',
  },
  {
    name: 'a doctor corrected by an Admin',
    call: (req: Request) => putOne(req, id('d1')),
    path: 'd1',
    apiPath: '/doctor-profiles/d1',
  },
];

beforeEach(() => {
  callStaffApiMock.mockReset();
  hasAccessCookie = true;
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { saved: true } });
});

describe.each(CASES)('doctor profile route: $name', (c) => {
  it('forwards the body untouched to its API path', async () => {
    const body = { qualifications: 'MBBS', anything: 1 };
    const res = await c.call(request(c.path, body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(callStaffApiMock).toHaveBeenCalledWith(
      c.apiPath,
      expect.objectContaining({ method: 'PUT', body }),
    );
  });

  it('refuses a foreign origin, junk and a non-object body without calling the API', async () => {
    expect((await c.call(request(c.path, {}, { Origin: 'https://evil.example' }))).status).toBe(
      403,
    );
    expect(
      (await c.call(request(c.path, {}, { 'Content-Type': 'text/plain' }))).status,
    ).toBeGreaterThanOrEqual(400);
    const junk = await c.call(
      new Request(`${ORIGIN}/api/staff/doctor-profiles/${c.path}`, {
        method: 'PUT',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(junk.status).toBe(400);
    for (const body of [[], 'text', 5, null]) {
      const res = await c.call(request(c.path, body));
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the code, field and reason of a refusal to the browser, and nothing else', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: { code: 'SETTINGS_INVALID', field: 'registrationNo', reason: 'INVALID', secret: 'x' },
    });
    const res = await c.call(request(c.path, {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'SETTINGS_INVALID',
      field: 'registrationNo',
      reason: 'INVALID',
    });
  });

  it('keeps 403 as 403 and 404 as 404', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: { code: 'FORBIDDEN' } });
    expect((await c.call(request(c.path, {}))).status).toBe(403);
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 404,
      body: { code: 'SETTINGS_NOT_FOUND' },
    });
    const res = await c.call(request(c.path, {}));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('SETTINGS_NOT_FOUND');
  });

  it('answers a JSON 401 without the access cookie and never calls the API', async () => {
    hasAccessCookie = false;
    const res = await c.call(request(c.path, {}));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});

describe('the doctor id in the path is encoded', () => {
  it('slashes, dots and query marks cannot change the API path', async () => {
    await putOne(request('x', {}), id('../../x?y=1'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/doctor-profiles/..%2F..%2Fx%3Fy%3D1',
      expect.anything(),
    );
  });
});
