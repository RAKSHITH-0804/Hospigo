/**
 * @jest-environment node
 */

const refreshTokensMock = jest.fn();
const mockCookiesStore = new Map<string, string>();

jest.mock('@/lib/auth/api-client', () => ({
  refreshTokens: (...args: unknown[]) => refreshTokensMock(...args),
}));

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookiesStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { clearRefreshFlightsForTests } from '@/lib/auth/refresh-flight';
import { sessionConfig } from '@/config/session';
import { POST } from './route';

describe('POST /api/auth/refresh-session', () => {
  beforeEach(() => {
    refreshTokensMock.mockReset();
    mockCookiesStore.clear();
    clearRefreshFlightsForTests();
  });

  it('sets session cookies and returns { ok: true } with no token in the body', async () => {
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'old-refresh');
    refreshTokensMock.mockResolvedValue({
      ok: true,
      data: {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      },
    });
    const res = await POST(
      new Request('http://127.0.0.1:3001/api/auth/refresh-session', {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('location')).toBeNull();
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(JSON.stringify(json)).not.toMatch(/access|refresh|token/i);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const joined = setCookie.join(';');
    expect(joined).toContain('new-access');
    expect(joined).toContain('new-refresh');
  });

  it('returns 401, clears cookies, and never redirects on failure', async () => {
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'dead-refresh');
    refreshTokensMock.mockResolvedValue({ ok: false, status: 401 });
    const res = await POST(
      new Request('http://127.0.0.1:3001/api/auth/refresh-session', {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    const json = await res.json();
    expect(json.ok).toBe(false);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    expect(setCookie.join(';')).toMatch(/Max-Age=0|max-age=0/i);
  });

  it('returns 401 and clears cookies when refresh cookie is missing', async () => {
    const res = await POST(
      new Request('http://127.0.0.1:3001/api/auth/refresh-session', {
        method: 'POST',
      }),
    );
    expect(res.status).toBe(401);
    expect(refreshTokensMock).not.toHaveBeenCalled();
  });
});
