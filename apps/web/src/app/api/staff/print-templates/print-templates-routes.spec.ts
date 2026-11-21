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

import { DELETE, PUT } from './[docType]/route';

const ORIGIN = 'http://127.0.0.1:3001';
const URL_OF = (doc: string) => `${ORIGIN}/api/staff/print-templates/${doc}`;
const ctx = (docType: string) => ({ params: Promise.resolve({ docType }) });

function request(
  method: string,
  doc: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(URL_OF(doc), {
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

const template = { paper: 'A5', mode: 'FULL', layout: { version: 1 } };

beforeEach(() => {
  callStaffApiMock.mockReset();
  hasAccessCookie = true;
  callStaffApiMock.mockResolvedValue({ ok: true, status: 200, data: { saved: true } });
});

describe('PUT /api/staff/print-templates/:docType', () => {
  it('forwards the body untouched to the API path of that document', async () => {
    const res = await PUT(request('PUT', 'RECEIPT', template), ctx('RECEIPT'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/print-templates/RECEIPT',
      expect.objectContaining({ method: 'PUT', body: template }),
    );
  });

  it('refuses an unknown document type without calling the API', async () => {
    for (const doc of ['receipt', 'BILL', '..%2Fx', 'RECEIPT/extra', '']) {
      const res = await PUT(request('PUT', 'RECEIPT', template), ctx(doc));
      expect({ doc, status: res.status }).toEqual({ doc, status: 400 });
      expect((await res.json()).code).toBe('PRINT_DOC_TYPE_INVALID');
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('refuses a foreign origin, a wrong content type, a non-object body and a stale tab', async () => {
    const foreign = await PUT(
      request('PUT', 'RECEIPT', template, { Origin: 'https://evil.example' }),
      ctx('RECEIPT'),
    );
    expect(foreign.status).toBe(403);
    const wrongType = await PUT(
      request('PUT', 'RECEIPT', template, { 'Content-Type': 'text/plain' }),
      ctx('RECEIPT'),
    );
    expect(wrongType.status).toBe(415);
    const notObject = await PUT(request('PUT', 'RECEIPT', [1, 2]), ctx('RECEIPT'));
    expect(notObject.status).toBe(400);
    const stale = await PUT(
      request('PUT', 'RECEIPT', template, { 'x-hospigo-branch': 'branch-2' }),
      ctx('RECEIPT'),
    );
    expect(stale.status).toBe(409);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('passes the field and the reason of a refused template to the browser', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: {
        code: 'PRINT_TEMPLATE_INVALID',
        field: 'margins',
        reason: 'NO_ROOM_TO_PRINT_DOWN',
        secret: 'x',
      },
    });
    const res = await PUT(request('PUT', 'RECEIPT', template), ctx('RECEIPT'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'PRINT_TEMPLATE_INVALID',
      field: 'margins',
      reason: 'NO_ROOM_TO_PRINT_DOWN',
    });
  });

  it('answers JSON 401 without a session and 403 when the API refuses', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: { code: 'FORBIDDEN' } });
    const forbidden = await PUT(request('PUT', 'RECEIPT', template), ctx('RECEIPT'));
    expect(forbidden.status).toBe(403);
    hasAccessCookie = false;
    callStaffApiMock.mockClear();
    const none = await PUT(request('PUT', 'RECEIPT', template), ctx('RECEIPT'));
    expect(none.status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/staff/print-templates/:docType', () => {
  it('asks the API to go back to the default', async () => {
    const res = await DELETE(request('DELETE', 'PRESCRIPTION'), ctx('PRESCRIPTION'));
    expect(res.status).toBe(200);
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/print-templates/PRESCRIPTION',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refuses an unknown type, a foreign origin and a stale tab without calling the API', async () => {
    expect((await DELETE(request('DELETE', 'x'), ctx('x'))).status).toBe(400);
    expect(
      (
        await DELETE(
          request('DELETE', 'RECEIPT', undefined, { Origin: 'https://evil.example' }),
          ctx('RECEIPT'),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await DELETE(
          request('DELETE', 'RECEIPT', undefined, { 'x-hospigo-branch': 'branch-9' }),
          ctx('RECEIPT'),
        )
      ).status,
    ).toBe(409);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
