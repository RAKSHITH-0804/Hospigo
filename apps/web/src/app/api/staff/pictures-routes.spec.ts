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

import { imageUploadConfig } from '@/config/images';
import { GET as getImage } from './images/[id]/route';
import { PUT as putLogo } from './branding/logo/route';
import { POST as removeLogo } from './branding/logo/remove/route';
import { PUT as putMySignature } from './doctor-profiles/me/signature/route';
import { POST as removeMySignature } from './doctor-profiles/me/signature/remove/route';
import { PUT as putSignature } from './doctor-profiles/[id]/signature/route';
import { POST as removeSignature } from './doctor-profiles/[id]/signature/remove/route';

const ORIGIN = 'http://127.0.0.1:3001';
const id = (v: string) => ({ params: Promise.resolve({ id: v }) });

function formRequest(
  entries: Array<[string, string | Blob]> | null,
  headers: Record<string, string> = {},
  length?: number,
) {
  const form = new FormData();
  for (const [key, value] of entries ?? []) {
    if (typeof value === 'string') form.append(key, value);
    else form.append(key, value, 'x.png');
  }
  return new Request(`${ORIGIN}/api/staff/upload`, {
    method: 'PUT',
    headers: {
      Origin: ORIGIN,
      'x-hospigo-branch': 'branch-1',
      'content-length': String(length ?? 2000),
      ...headers,
    },
    body: entries === null ? undefined : form,
  });
}
const file = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

const UPLOADS = [
  { name: 'logo', call: (r: Request) => putLogo(r), api: '/settings/branding/logo' },
  {
    name: 'my signature',
    call: (r: Request) => putMySignature(r),
    api: '/doctor-profiles/me/signature',
  },
  {
    name: 'a doctor signature (id encoded)',
    call: (r: Request) => putSignature(r, id('d 1')),
    api: '/doctor-profiles/d%201/signature',
  },
];
const REMOVES = [
  { name: 'logo', call: (r: Request) => removeLogo(r), api: '/settings/branding/logo/remove' },
  {
    name: 'my signature',
    call: (r: Request) => removeMySignature(r),
    api: '/doctor-profiles/me/signature/remove',
  },
  {
    name: 'a doctor signature',
    call: (r: Request) => removeSignature(r, id('d1')),
    api: '/doctor-profiles/d1/signature/remove',
  },
];

beforeEach(() => {
  callStaffApiMock.mockReset();
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { done: true } });
  hasAccessCookie = true;
});

describe.each(UPLOADS)('upload: $name', ({ call, api }) => {
  it('passes only the file on, to the API path, with the branch guard checked', async () => {
    const res = await call(formRequest([['file', file()]]));
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledTimes(1);
    const [path, options] = callStaffApiMock.mock.calls[0]!;
    expect(path).toBe(api);
    expect(options.method).toBe('PUT');
    expect(options.body).toBeUndefined();
    const form = options.form as FormData;
    expect([...form.keys()]).toEqual(['file']);
    expect((form.get('file') as File).name).toBe('picture'); // the name from the browser is dropped
  });

  it('is refused from another origin, as JSON, without a login, or from a stale tab', async () => {
    expect(
      (await call(formRequest([['file', file()]], { Origin: 'http://evil.test' }))).status,
    ).toBe(403);
    expect(
      (await call(formRequest([['file', file()]], { 'content-type': 'application/json' }))).status,
    ).toBe(415);
    expect(
      (await call(formRequest([['file', file()]], { 'x-hospigo-branch': 'branch-2' }))).status,
    ).toBe(409);
    hasAccessCookie = false;
    expect((await call(formRequest([['file', file()]]))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a huge body before reading it, and a missing length, with the plain reasons', async () => {
    const big = await call(
      formRequest([['file', file()]], {}, imageUploadConfig.bffMaxBodyBytes + 1),
    );
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({
      code: 'SETTINGS_INVALID',
      field: 'file',
      reason: 'TOO_BIG',
    });
    const none = await call(formRequest([['file', file()]], { 'content-length': '0' }));
    expect(none.status).toBe(400);
    expect((await none.json()).reason).toBe('REQUIRED');
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a form that is not exactly one file named "file"', async () => {
    const cases: Array<Array<[string, string | Blob]>> = [
      [],
      [['photo', file()]],
      [['file', 'just text']],
      [
        ['file', file()],
        ['tenantId', 'other'],
      ],
      [
        ['file', file()],
        ['file', file()],
      ],
    ];
    for (const entries of cases) {
      const res = await call(formRequest(entries));
      expect(res.status).toBe(400);
      expect((await res.json()).reason).toBe('REQUIRED');
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes on the API refusal with its small facts only', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: {
        code: 'SETTINGS_INVALID',
        field: 'file',
        reason: 'NOT_AN_IMAGE',
        storageKey: 'secret',
      },
    });
    const res = await call(formRequest([['file', file()]]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'SETTINGS_INVALID',
      field: 'file',
      reason: 'NOT_AN_IMAGE',
    });
  });
});

describe.each(REMOVES)('remove: $name', ({ call, api }) => {
  const post = (headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/staff/x`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'x-hospigo-branch': 'branch-1',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: '{}',
    });

  it('goes to the API path', async () => {
    expect((await call(post())).status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(api, expect.objectContaining({ method: 'POST' }));
  });

  it('is refused from another origin, from a stale tab and without a login', async () => {
    expect((await call(post({ Origin: 'http://evil.test' }))).status).toBe(403);
    expect((await call(post({ 'x-hospigo-branch': 'branch-2' }))).status).toBe(409);
    hasAccessCookie = false;
    expect((await call(post())).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});

describe('GET a picture', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const get = (value: string) =>
    getImage(new Request(`${ORIGIN}/api/staff/images/${value}`), id(value));

  it('shows a known picture type with safe headers; the token is never in the answer', async () => {
    callStaffApiMock.mockResolvedValue({ ok: true, data: bytes, contentType: 'image/png' });
    const res = await get('abc');
    expect(callStaffApiMock).toHaveBeenCalledWith('/images/abc', { method: 'GET', raw: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('cache-control')).toContain('private');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(JSON.stringify([...res.headers.entries()])).not.toMatch(/bearer|token|hospigo_access/i);
  });

  it('accepts jpeg and webp with a charset note, and drops the note', async () => {
    for (const type of ['image/jpeg', 'image/webp; charset=binary']) {
      callStaffApiMock.mockResolvedValue({ ok: true, data: bytes, contentType: type });
      const res = await get('abc');
      expect(res.headers.get('content-type')).toBe(type.split(';')[0]);
    }
  });

  it('never passes on anything that is not a picture type (SVG, HTML, nothing)', async () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', undefined]) {
      callStaffApiMock.mockResolvedValue({ ok: true, data: bytes, contentType: type });
      expect((await get('abc')).status).toBe(502);
    }
  });

  it('without a login it is 401 and the API is not asked; the API answers 401, 403, 404 stay; others are 502', async () => {
    hasAccessCookie = false;
    expect((await get('abc')).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
    hasAccessCookie = true;
    for (const status of [401, 403, 404]) {
      callStaffApiMock.mockResolvedValue({ ok: false, status });
      expect((await get('abc')).status).toBe(status);
    }
    callStaffApiMock.mockResolvedValue({ ok: false, status: 500 });
    expect((await get('abc')).status).toBe(502);
  });

  it('encodes the id so it can only be one path segment', async () => {
    callStaffApiMock.mockResolvedValue({ ok: true, data: bytes, contentType: 'image/png' });
    await get('../roles');
    expect(callStaffApiMock.mock.calls[0]![0]).toBe('/images/..%2Froles');
  });
});
