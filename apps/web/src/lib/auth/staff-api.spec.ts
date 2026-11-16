/**
 * @jest-environment node
 */

const callApiMock = jest.fn();

jest.mock('./api-client', () => {
  const actual = jest.requireActual('./api-client') as typeof import('./api-client');
  return {
    ...actual,
    callApi: (...args: unknown[]) => callApiMock(...args),
  };
});

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

import { cookies, headers } from 'next/headers';
import { callStaffApi } from './staff-api';

describe('callStaffApi', () => {
  beforeEach(() => {
    callApiMock.mockReset();
    (cookies as jest.Mock).mockResolvedValue({
      get: (name: string) =>
        name === 'hospigo_access' ? { value: 'staff-access-token' } : undefined,
    });
    (headers as jest.Mock).mockResolvedValue({
      get: (name: string) => {
        if (name === 'x-forwarded-for') return '198.51.100.20';
        if (name === 'host') return '127.0.0.1:3001';
        return null;
      },
    });
  });

  it('sends Bearer auth and never forwards browser Cookie', async () => {
    callApiMock.mockResolvedValue({ ok: true, data: { id: '1' } });
    await callStaffApi('/patients/search', { query: { name: 'Abc' } });
    expect(callApiMock).toHaveBeenCalledTimes(1);
    const [request, path, init] = callApiMock.mock.calls[0] as [
      Request,
      string,
      { headers?: HeadersInit; timeoutMs?: number },
    ];
    expect(path).toBe('/patients/search?name=Abc');
    const hdrs = new Headers(init.headers);
    expect(hdrs.get('Authorization')).toBe('Bearer staff-access-token');
    expect(hdrs.get('Cookie')).toBeNull();
    expect(request.headers.get('cookie')).toBeNull();
    expect(init.timeoutMs).toBe(8000);
  });

  it('returns 401 when access cookie is missing', async () => {
    (cookies as jest.Mock).mockResolvedValue({ get: () => undefined });
    const result = await callStaffApi('/patients');
    expect(result).toEqual({ ok: false, status: 401 });
    expect(callApiMock).not.toHaveBeenCalled();
  });

  it('passthrough upstream 401/403/404', async () => {
    for (const status of [401, 403, 404]) {
      callApiMock.mockResolvedValueOnce({ ok: false, status });
      const result = await callStaffApi('/patients/x');
      expect(result).toEqual({ ok: false, status });
    }
  });

  it('maps timeout/network failure through callApi (503)', async () => {
    callApiMock.mockResolvedValue({ ok: false, status: 503 });
    const result = await callStaffApi('/patients');
    expect(result).toEqual({ ok: false, status: 503 });
  });
});
