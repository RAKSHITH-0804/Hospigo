const refreshMock = jest.fn();
let activeBranch: string | null = 'branch-1';
jest.mock('@/lib/auth/client-session', () => ({
  AUTH_REFRESH_SESSION_API: '/api/auth/refresh-session',
  clearClientRefreshLatchForTests: () => undefined,
  getClientActiveBranch: () => activeBranch,
  refreshSessionOnce: () => refreshMock(),
}));

import { branchSwitchConfig } from '@/config/branch-switch';
import { removeLogo, uploadLogo, uploadPicture } from './client';
import { IMAGE_ROUTES } from './types';

const fetchMock = jest.fn();
const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const png = () => new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  activeBranch = 'branch-1';
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('uploadPicture', () => {
  it('sends the file as a form with the branch guard header and the cookie, and no JSON type', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'i1' }));
    const result = await uploadPicture('/api/staff/x', png());
    expect(result).toEqual({ ok: true, data: { id: 'i1' } });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/staff/x');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect(init.headers[branchSwitchConfig.headerName]).toBe('branch-1');
    expect(init.headers['Content-Type']).toBeUndefined(); // the browser adds the multipart boundary
    expect(init.body).toBeInstanceOf(FormData);
    const entries = [...(init.body as FormData).entries()];
    expect(entries).toHaveLength(1);
    expect(entries[0]![0]).toBe('file');
  });

  it('gives back the refusal facts (code, reason, field), never the raw body', async () => {
    fetchMock.mockResolvedValue(
      json(400, { code: 'SETTINGS_INVALID', field: 'file', reason: 'NOT_AN_IMAGE', secret: 'x' }),
    );
    expect(await uploadPicture('/api/staff/x', png())).toEqual({
      ok: false,
      status: 400,
      code: 'SETTINGS_INVALID',
      field: 'file',
      reason: 'NOT_AN_IMAGE',
    });
  });

  it('a network failure is UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await uploadPicture('/api/staff/x', png())).toMatchObject({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it('an expired session is refreshed once and the same upload is tried again', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'SESSION_EXPIRED' }))
      .mockResolvedValueOnce(json(200, { id: 'i2' }));
    refreshMock.mockResolvedValue(true);
    expect(await uploadPicture('/api/staff/x', png())).toEqual({ ok: true, data: { id: 'i2' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('when the refresh fails the person is told the session ended; there is no endless retry', async () => {
    fetchMock.mockResolvedValue(json(401, { code: 'SESSION_EXPIRED' }));
    refreshMock.mockResolvedValue(false);
    expect(await uploadPicture('/api/staff/x', png())).toMatchObject({
      ok: false,
      code: 'SESSION_EXPIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json(401, { code: 'SESSION_EXPIRED' }));
    refreshMock.mockResolvedValue(true);
    await uploadPicture('/api/staff/x', png());
    expect(fetchMock).toHaveBeenCalledTimes(2); // one retry only
  });

  it('sends no branch header when the page has no branch', async () => {
    activeBranch = null;
    fetchMock.mockResolvedValue(json(200, {}));
    await uploadPicture('/api/staff/x', png());
    expect(fetchMock.mock.calls[0]![1].headers[branchSwitchConfig.headerName]).toBeUndefined();
  });
});

describe('logo calls', () => {
  it('upload and remove go to the logo routes', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'i1' }));
    await uploadLogo(png());
    expect(fetchMock.mock.calls[0]![0]).toBe(IMAGE_ROUTES.logo);
    fetchMock.mockResolvedValue(json(200, { logo: null }));
    await removeLogo();
    expect(fetchMock.mock.calls[1]![0]).toBe(IMAGE_ROUTES.logoRemove);
    expect(fetchMock.mock.calls[1]![1].method).toBe('POST');
  });
});
