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

import { importScreenConfig } from '@/config/imports';
import { GET as getList } from './route';
import { GET as getOne } from './[id]/route';
import { GET as getRows } from './[id]/rows/route';
import { POST as postAction } from './[id]/[action]/route';
import { POST as postUpload } from './[id]/upload/route';
import { GET as getTemplate } from './templates/[type]/route';

const ORIGIN = 'http://127.0.0.1:3001';
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const actionCtx = (id: string, action: string) => ({ params: Promise.resolve({ id, action }) });
const typeCtx = (type: string) => ({ params: Promise.resolve({ type }) });

beforeEach(() => {
  callStaffApiMock.mockReset();
  hasAccessCookie = true;
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
});

describe('GET routes', () => {
  it('forward only the known query values and encode the id', async () => {
    await getList(new Request(`${ORIGIN}/api/staff/imports?page=2&pageSize=10&evil=1`));
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/imports', {
      method: 'GET',
      query: { page: '2', pageSize: '10' },
    });
    await getOne(new Request(`${ORIGIN}/api/staff/imports/b1`), idCtx('a/b'));
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/imports/a%2Fb', {
      method: 'GET',
      query: undefined,
    });
    await getRows(
      new Request(`${ORIGIN}/api/staff/imports/b1/rows?status=EXCEPTION&page=3&x=1`),
      idCtx('b1'),
    );
    expect(callStaffApiMock).toHaveBeenLastCalledWith('/imports/b1/rows', {
      method: 'GET',
      query: { status: 'EXCEPTION', page: '3' },
    });
  });

  it('return JSON 401 without the cookie and never call the API', async () => {
    hasAccessCookie = false;
    expect((await getList(new Request(`${ORIGIN}/api/staff/imports`))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('pass a refusal on as FORBIDDEN and an outage as UNAVAILABLE', async () => {
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 403, body: {} });
    const refused = await getOne(new Request(`${ORIGIN}/x`), idCtx('b1'));
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe('FORBIDDEN');
    callStaffApiMock.mockResolvedValueOnce({ ok: false, status: 503, body: {} });
    expect((await getOne(new Request(`${ORIGIN}/x`), idCtx('b1'))).status).toBe(503);
  });
});

describe('POST /api/staff/imports/:id/:action', () => {
  const post = (headers: Record<string, string> = {}, body: unknown = {}) =>
    new Request(`${ORIGIN}/api/staff/imports/b1/post`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'x-hospigo-branch': 'branch-1',
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it.each(['approve', 'post', 'cancel'])('passes %s on to the API', async (action) => {
    const res = await postAction(post(), actionCtx('b1', action));
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(`/imports/b1/${action}`, {
      method: 'POST',
      query: undefined,
      body: {},
    });
  });

  it('answers 404 for any other action and never calls the API', async () => {
    for (const action of ['undo', 'delete', 'upload', '..']) {
      expect((await postAction(post(), actionCtx('b1', action))).status).toBe(404);
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a foreign Origin, a stale tab and a body that is not an object', async () => {
    expect(
      (await postAction(post({ Origin: 'https://evil.example' }), actionCtx('b1', 'post'))).status,
    ).toBe(403);
    const stale = await postAction(
      post({ 'x-hospigo-branch': 'branch-2' }),
      actionCtx('b1', 'post'),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('BRANCH_CHANGED');
    expect((await postAction(post({}, [1]), actionCtx('b1', 'post'))).status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the refusal code on, nothing else', async () => {
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { code: 'IMPORT_BUSY', secret: 'x' },
    });
    const res = await postAction(post(), actionCtx('b1', 'post'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'IMPORT_BUSY' });
  });
});

describe('POST /api/staff/imports/:type/upload', () => {
  const file = () =>
    new File([new Uint8Array([80, 75, 3, 4])], 'list.xlsx', {
      type: 'application/octet-stream',
    });

  function upload(
    entries: Array<[string, string | Blob]> | null,
    headers: Record<string, string> = {},
    length = 2000,
  ) {
    const form = new FormData();
    for (const [key, value] of entries ?? []) {
      if (typeof value === 'string') form.append(key, value);
      else form.append(key, value, 'list.xlsx');
    }
    return new Request(`${ORIGIN}/api/staff/imports/MEDICINES/upload`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'x-hospigo-branch': 'branch-1',
        'content-length': String(length),
        ...headers,
      },
      body: entries === null ? undefined : form,
    });
  }

  it('sends only the file to the API path of that list', async () => {
    const res = await postUpload(upload([['file', file()]]), idCtx('MEDICINES') as never);
    expect(res.status).toBe(200);
    const [path, options] = callStaffApiMock.mock.calls[0]!;
    expect(path).toBe('/imports/MEDICINES/upload');
    expect(options.method).toBe('POST');
    const sent = options.form as FormData;
    expect([...sent.keys()]).toEqual(['file']);
  });

  it('answers 404 for an unknown list', async () => {
    const res = await postUpload(upload([['file', file()]]), idCtx('PATIENTS') as never);
    expect(res.status).toBe(404);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses before reading: foreign Origin, not multipart, no length, too big, no file, extra fields', async () => {
    const ctx = idCtx('MEDICINES') as never;
    expect(
      (await postUpload(upload([['file', file()]], { Origin: 'https://evil.example' }), ctx))
        .status,
    ).toBe(403);
    expect(
      (await postUpload(upload([['file', file()]], { 'content-type': 'application/json' }), ctx))
        .status,
    ).toBe(415);
    const noLength = upload([['file', file()]], { 'content-length': '0' });
    const r1 = await postUpload(noLength, ctx);
    expect(r1.status).toBe(400);
    expect((await r1.json()).reason).toBe('NO_FILE');
    const big = await postUpload(
      upload([['file', file()]], {}, importScreenConfig.bffMaxBodyBytes + 1),
      ctx,
    );
    expect(big.status).toBe(400);
    expect((await big.json()).reason).toBe('TOO_BIG');
    expect((await postUpload(upload([['name', 'x']]), ctx)).status).toBe(400);
    expect(
      (
        await postUpload(
          upload([
            ['file', file()],
            ['extra', 'x'],
          ]),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('a stale tab is 409 and a missing cookie is 401', async () => {
    const ctx = idCtx('MEDICINES') as never;
    const stale = await postUpload(
      upload([['file', file()]], { 'x-hospigo-branch': 'branch-2' }),
      ctx,
    );
    expect(stale.status).toBe(409);
    hasAccessCookie = false;
    expect((await postUpload(upload([['file', file()]]), ctx)).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the refusal reason of a bad file on, nothing else', async () => {
    callStaffApiMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      body: { code: 'IMPORT_FILE_INVALID', reason: 'MACROS', secret: 'x' },
    });
    const res = await postUpload(upload([['file', file()]]), idCtx('MEDICINES') as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'IMPORT_FILE_INVALID', reason: 'MACROS' });
  });
});

describe('GET /api/staff/imports/templates/:type', () => {
  it('passes the Excel bytes on as a download', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]).buffer;
    callStaffApiMock.mockResolvedValueOnce({ ok: true, status: 200, data: bytes });
    const res = await getTemplate(new Request(`${ORIGIN}/x`), typeCtx('TESTS'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toContain('tests-template.xlsx');
    expect(callStaffApiMock.mock.calls[0]![0]).toBe('/imports/templates/TESTS');
  });

  it('answers 404 for an unknown list', async () => {
    expect((await getTemplate(new Request(`${ORIGIN}/x`), typeCtx('PATIENTS'))).status).toBe(404);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
