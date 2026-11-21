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

import { PUT as putOpdRules } from './opd-rules/route';
import { PUT as putBuiltin } from './patient-fields/builtin/[key]/route';
import { POST as postCustom } from './patient-fields/custom/route';
import { PATCH as patchCustom } from './patient-fields/custom/[id]/route';
import { PUT as putOptions } from './patient-fields/custom/[id]/options/route';
import { POST as postUhidFormat } from './uhid-format/route';

const ORIGIN = 'http://127.0.0.1:3001';

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}/api/staff/settings/${path}`, {
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

const key = (v: string) => ({ params: Promise.resolve({ key: v }) });
const id = (v: string) => ({ params: Promise.resolve({ id: v }) });

type Case = {
  name: string;
  call: (req: Request) => Promise<Response>;
  method: string;
  path: string;
  apiPath: string;
};

const CASES: Case[] = [
  {
    name: 'opd rules',
    call: (req) => putOpdRules(req),
    method: 'PUT',
    path: 'opd-rules',
    apiPath: '/settings/opd-rules',
  },
  {
    name: 'built-in field',
    call: (req) => putBuiltin(req, key('gender')),
    method: 'PUT',
    path: 'patient-fields/builtin/gender',
    apiPath: '/settings/patient-fields/builtin/gender',
  },
  {
    name: 'add custom field',
    call: (req) => postCustom(req),
    method: 'POST',
    path: 'patient-fields/custom',
    apiPath: '/settings/patient-fields/custom',
  },
  {
    name: 'change custom field',
    call: (req) => patchCustom(req, id('f1')),
    method: 'PATCH',
    path: 'patient-fields/custom/f1',
    apiPath: '/settings/patient-fields/custom/f1',
  },
  {
    name: 'custom choices',
    call: (req) => putOptions(req, id('f1')),
    method: 'PUT',
    path: 'patient-fields/custom/f1/options',
    apiPath: '/settings/patient-fields/custom/f1/options',
  },
  {
    name: 'uhid format',
    call: (req) => postUhidFormat(req),
    method: 'POST',
    path: 'uhid-format',
    apiPath: '/settings/uhid-format',
  },
];

beforeEach(() => {
  callStaffApiMock.mockReset();
  hasAccessCookie = true;
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { saved: true } });
});

describe.each(CASES)('settings route: $name', (c) => {
  it('forwards the body untouched to its API path', async () => {
    const body = { anything: 1 };
    const res = await c.call(request(c.method, c.path, body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(callStaffApiMock).toHaveBeenCalledWith(
      c.apiPath,
      expect.objectContaining({ method: c.method, body }),
    );
  });

  it('refuses a foreign origin, a wrong content type, junk and a non-object body without calling the API', async () => {
    const foreign = await c.call(request(c.method, c.path, {}, { Origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    const wrongType = await c.call(request(c.method, c.path, {}, { 'Content-Type': 'text/plain' }));
    expect(wrongType.status).toBeGreaterThanOrEqual(400);
    const junk = await c.call(
      new Request(`${ORIGIN}/api/staff/settings/${c.path}`, {
        method: c.method,
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(junk.status).toBe(400);
    for (const body of [[], 'text', 5, null]) {
      const res = await c.call(request(c.method, c.path, body));
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the code, the field and the reason of a refusal to the browser, and nothing else', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: { code: 'SETTINGS_INVALID', field: 'label', reason: 'REQUIRED', secret: 'x' },
    });
    const res = await c.call(request(c.method, c.path, {}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ code: 'SETTINGS_INVALID', field: 'label', reason: 'REQUIRED' });
  });

  it('answers a JSON 401 without the access cookie and never calls the API', async () => {
    hasAccessCookie = false;
    const res = await c.call(request(c.method, c.path, {}));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});

describe('the path parameters are encoded', () => {
  it('a field key or id with slashes or dots cannot change the API path', async () => {
    await putBuiltin(request('PUT', 'patient-fields/builtin/x', {}), key('../../x?y=1'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/patient-fields/builtin/..%2F..%2Fx%3Fy%3D1',
      expect.anything(),
    );
    await patchCustom(request('PATCH', 'patient-fields/custom/x', {}), id('a/b'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/patient-fields/custom/a%2Fb',
      expect.anything(),
    );
    await putOptions(request('PUT', 'patient-fields/custom/x/options', {}), id('a/../b'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith(
      '/settings/patient-fields/custom/a%2F..%2Fb/options',
      expect.anything(),
    );
  });
});
