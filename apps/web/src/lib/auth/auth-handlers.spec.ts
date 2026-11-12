/**
 * @jest-environment node
 */
import { sessionConfig } from '@/config/session';
import { clearRefreshFlightsForTests } from './refresh-flight';
import { appUrl, sanitizeNextPath } from './http';

const mockCookiesStore = new Map<string, string>();

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookiesStore.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => {
      mockCookiesStore.set(name, value);
    },
    delete: (name: string | { name: string; path?: string }) => {
      const key = typeof name === 'string' ? name : name.name;
      mockCookiesStore.delete(key);
    },
  }),
}));

process.env.APP_URL = 'http://127.0.0.1:3001';
process.env.API_INTERNAL_URL = 'http://127.0.0.1:3000';

function originHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    Origin: 'http://127.0.0.1:3001',
    'Content-Type': 'application/json',
    ...extra,
  };
}

describe('auth route handlers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockCookiesStore.clear();
    clearRefreshFlightsForTests();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('hospital-login success sets httpOnly cookies and returns no tokens in JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        expiresIn: 900,
        mustChangePassword: false,
      }),
    });
    const { POST } = await import('@/app/api/auth/hospital-login/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({
          accessCode: 'demo-north-main',
          email: 'staff@demo-north.example.test',
          password: 'x',
        }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ mustChangePassword: false });
    expect(JSON.stringify(json)).not.toMatch(/access-token|refresh-token/i);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const cookieBlob = setCookie.join(';');
    expect(cookieBlob).toContain(sessionConfig.cookieAccessName);
    expect(cookieBlob.toLowerCase()).toContain('httponly');
    expect(cookieBlob).toContain(sessionConfig.cookieRefreshName);
  });

  it('change-password success sets cookies and returns no tokens in JSON', async () => {
    mockCookiesStore.set(sessionConfig.cookieChangeName, 'change-token');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'post-change-access',
        refreshToken: 'post-change-refresh',
        expiresIn: 900,
        mustChangePassword: false,
      }),
    });
    const { POST } = await import('@/app/api/auth/change-password/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/change-password', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ currentPassword: 'old-pass', newPassword: 'new-pass-1' }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ mustChangePassword: false });
    expect(JSON.stringify(json)).not.toMatch(
      /post-change-access|post-change-refresh|accessToken|refreshToken/i,
    );
    const setCookie = (response.headers.getSetCookie?.() ?? []).join(';');
    expect(setCookie).toContain('post-change-access');
    expect(setCookie).toContain('post-change-refresh');
  });

  it('change-password maps API 400 password rules to web 400 VALIDATION', async () => {
    mockCookiesStore.set(sessionConfig.cookieChangeName, 'change-token');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => ({
        statusCode: 400,
        message: 'Password rejected: TOO_SHORT',
        error: 'Bad Request',
      }),
    });
    const { POST } = await import('@/app/api/auth/change-password/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/change-password', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ currentPassword: 'old-pass', newPassword: 'short' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'VALIDATION',
      message: 'Password rejected: TOO_SHORT',
    });
  });

  it('change-password does not forward non-string upstream 400 messages', async () => {
    mockCookiesStore.set(sessionConfig.cookieChangeName, 'change-token');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => ({ message: ['newPassword must be longer'], stack: 'Error: secret' }),
    });
    const { POST } = await import('@/app/api/auth/change-password/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/change-password', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ currentPassword: 'old-pass', newPassword: 'short' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'VALIDATION' });
  });

  it('change-password unexpected 2xx body returns 502 UNAVAILABLE', async () => {
    mockCookiesStore.set(sessionConfig.cookieChangeName, 'change-token');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ accessToken: 'only-access', expiresIn: 900 }),
    });
    const { POST } = await import('@/app/api/auth/change-password/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/change-password', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ currentPassword: 'old-pass', newPassword: 'new-pass-1' }),
      }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'UNAVAILABLE' });
  });

  it('500 paths log route metadata without secrets', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCookiesStore.set(sessionConfig.cookieChangeName, 'super-secret-change-token');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 418,
      headers: new Headers(),
      json: async () => ({
        message: 'Password rejected: TOO_SHORT',
        email: 'mustchange@demo-north.example.test',
        password: 'should-never-log',
      }),
    });
    const { POST } = await import('@/app/api/auth/change-password/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/change-password', {
        method: 'POST',
        headers: originHeaders({ 'x-request-id': 'req-test-1' }),
        body: JSON.stringify({
          currentPassword: 'should-never-log',
          newPassword: 'should-never-log-either',
        }),
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'UNKNOWN' });
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('POST /api/auth/change-password');
    expect(logged).toContain('upstreamStatus=418');
    expect(logged).toContain('requestId=req-test-1');
    expect(logged).not.toContain('should-never-log');
    expect(logged).not.toContain('super-secret-change-token');
    expect(logged).not.toContain('mustchange@');
    expect(logged).not.toMatch(/Bearer\s|Cookie:|currentPassword|newPassword/i);
    spy.mockRestore();
  });

  it('hospital-login mustChangePassword sets only the change cookie', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'change-only-token',
        expiresIn: 600,
        mustChangePassword: true,
      }),
    });
    const { POST } = await import('@/app/api/auth/hospital-login/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({
          accessCode: 'demo-north-main',
          email: 'mustchange@demo-north.example.test',
          password: 'x',
        }),
      }),
    );
    expect(await response.json()).toEqual({ mustChangePassword: true });
    const setCookie = (response.headers.getSetCookie?.() ?? []).join(';');
    expect(setCookie).toContain(sessionConfig.cookieChangeName);
    expect(setCookie).toContain('change-only-token');
  });

  it('maps API 401/429/503 to browser codes', async () => {
    const { POST } = await import('@/app/api/auth/hospital-login/route');
    const cases: Array<{ status: number; code: string }> = [
      { status: 401, code: 'INVALID_CREDENTIALS' },
      { status: 429, code: 'RATE_LIMITED' },
      { status: 503, code: 'UNAVAILABLE' },
    ];
    for (const c of cases) {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: c.status,
        headers: new Headers(c.status === 429 ? { 'retry-after': '30' } : {}),
        json: async () => ({}),
      });
      const response = await POST(
        new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
          method: 'POST',
          headers: originHeaders(),
          body: JSON.stringify({ accessCode: 'a', email: 'a@b.co', password: 'x' }),
        }),
      );
      expect(response.status).toBe(c.status);
      const body = await response.json();
      expect(body.code).toBe(c.code);
      if (c.status === 429) {
        expect(body.retryAfter).toBe('30');
      }
    }
  });

  it('BFF forwards client IP as X-Forwarded-For (respecting WEB_TRUST_FORWARDED_HEADERS) and does not forward browser Cookie/Authorization', async () => {
    const { sessionConfig: cfg } = await import('@/config/session');
    const previousTrust = cfg.trustForwardedHeaders;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        mustChangePassword: false,
      }),
    });
    const { POST } = await import('@/app/api/auth/hospital-login/route');
    const loginBody = JSON.stringify({
      accessCode: 'demo-north-main',
      email: 'staff@demo-north.example.test',
      password: 'x',
    });

    try {
      // Default / trust=false: spoofed x-forwarded-for ignored; socket IP forwarded.
      cfg.trustForwardedHeaders = false;
      const untrusted = new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
        method: 'POST',
        headers: originHeaders({
          'x-forwarded-for': '198.51.100.10, 10.0.0.1',
          Cookie: 'hospigo_access=browser-should-not-forward',
          Authorization: 'Bearer browser-forged-token',
        }),
        body: loginBody,
      });
      Object.defineProperty(untrusted, 'socket', {
        value: { remoteAddress: '203.0.113.55' },
      });
      await POST(untrusted);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url1, init1] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url1).toContain('/auth/hospital/login');
      const headers1 = new Headers(init1.headers);
      expect(headers1.get('X-Forwarded-For')).toBe('203.0.113.55');
      expect(headers1.get('Cookie')).toBeNull();
      expect(headers1.get('Authorization')).toBeNull();

      // trust=true: honour x-forwarded-for first hop.
      (global.fetch as jest.Mock).mockClear();
      cfg.trustForwardedHeaders = true;
      const trusted = new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
        method: 'POST',
        headers: originHeaders({
          'x-forwarded-for': '198.51.100.10, 10.0.0.1',
          Cookie: 'hospigo_refresh=also-not-forwarded',
          Authorization: 'Bearer another-forged',
        }),
        body: loginBody,
      });
      Object.defineProperty(trusted, 'socket', {
        value: { remoteAddress: '203.0.113.55' },
      });
      await POST(trusted);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, init2] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers2 = new Headers(init2.headers);
      expect(headers2.get('X-Forwarded-For')).toBe('198.51.100.10');
      expect(headers2.get('Cookie')).toBeNull();
      expect(headers2.get('Authorization')).toBeNull();
    } finally {
      cfg.trustForwardedHeaders = previousTrust;
    }
  });

  it('rejects Origin mismatch and non-JSON content type', async () => {
    const { POST } = await import('@/app/api/auth/hospital-login/route');
    const badOrigin = await POST(
      new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: 'a', email: 'a@b.co', password: 'x' }),
      }),
    );
    expect(badOrigin.status).toBe(403);

    const badCt = await POST(
      new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:3001', 'Content-Type': 'text/plain' },
        body: 'x',
      }),
    );
    expect(badCt.status).toBe(415);
  });

  it('refresh next validation rejects open redirects', () => {
    expect(sanitizeNextPath('//evil.com', '/app')).toBe('/app');
    expect(sanitizeNextPath('https://evil.com', '/app')).toBe('/app');
    expect(sanitizeNextPath('/\\evil', '/app')).toBe('/app');
    expect(sanitizeNextPath('/app/opd', '/app')).toBe('/app/opd');
  });

  it('appUrl uses APP_URL origin and rejects open redirects', () => {
    const env = { APP_URL: 'http://127.0.0.1:3001', NODE_ENV: 'test' };
    expect(appUrl('/app/opd', { env }).href).toBe('http://127.0.0.1:3001/app/opd');
    expect(appUrl('//evil.com', { env, fallback: '/app' }).href).toBe('http://127.0.0.1:3001/app');
    expect(appUrl('https://evil.com', { env, fallback: '/app' }).href).toBe(
      'http://127.0.0.1:3001/app',
    );
    expect(appUrl('/\\evil', { env, fallback: '/app' }).href).toBe('http://127.0.0.1:3001/app');
  });

  it('refresh Location origin equals APP_URL even when request host is localhost', async () => {
    process.env.APP_URL = 'http://127.0.0.1:3001';
    mockCookiesStore.clear();
    const { GET } = await import('@/app/api/auth/refresh/route');
    const fail = await GET(
      new Request('http://localhost:3001/api/auth/refresh?next=/app', { method: 'GET' }),
    );
    expect(fail.status).toBe(307);
    expect(new URL(fail.headers.get('location')!).origin).toBe('http://127.0.0.1:3001');
    expect(new URL(fail.headers.get('location')!).pathname).toBe('/login');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
        mustChangePassword: false,
      }),
    });
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'old-refresh');
    const ok = await GET(
      new Request('http://localhost:3001/api/auth/refresh?next=/app/opd', { method: 'GET' }),
    );
    expect(ok.status).toBe(307);
    expect(new URL(ok.headers.get('location')!).href).toBe('http://127.0.0.1:3001/app/opd');
  });

  it('refresh single-flight makes ONE API call for concurrent requests', async () => {
    let calls = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          accessToken: 'a2',
          refreshToken: 'r2',
          expiresIn: 900,
          mustChangePassword: false,
        }),
      };
    });
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'refresh-same');
    const { GET } = await import('@/app/api/auth/refresh/route');
    const req = () =>
      new Request('http://127.0.0.1:3001/api/auth/refresh?next=/app', { method: 'GET' });
    const [a, b] = await Promise.all([GET(req()), GET(req())]);
    expect(a.status).toBe(307);
    expect(b.status).toBe(307);
    expect(calls).toBe(1);
  });

  it('refresh with no cookie redirects to login', async () => {
    mockCookiesStore.clear();
    const { GET } = await import('@/app/api/auth/refresh/route');
    const response = await GET(
      new Request('http://127.0.0.1:3001/api/auth/refresh?next=/app', { method: 'GET' }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('successful refresh redirects to next and sets session cookies', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
        mustChangePassword: false,
      }),
    });
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'old-refresh');
    const { GET } = await import('@/app/api/auth/refresh/route');
    const response = await GET(
      new Request('http://127.0.0.1:3001/api/auth/refresh?next=/app/opd', { method: 'GET' }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/app/opd');
    expect(response.headers.get('location')).not.toContain('/login');
    const setCookie = (response.headers.getSetCookie?.() ?? []).join(';');
    expect(setCookie).toContain('new-access');
    expect(setCookie).toContain('new-refresh');
  });

  it('refresh failure clears cookies and redirects to login', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({}),
    });
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'dead-refresh');
    const { GET } = await import('@/app/api/auth/refresh/route');
    const response = await GET(
      new Request('http://127.0.0.1:3001/api/auth/refresh?next=/app', { method: 'GET' }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    const setCookie = (response.headers.getSetCookie?.() ?? []).join(';');
    expect(setCookie).toContain(`${sessionConfig.cookieAccessName}=`);
    expect(setCookie).toMatch(/Max-Age=0|max-age=0/i);
  });

  it('logout always clears cookies even if the API call fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'r1');
    mockCookiesStore.set(sessionConfig.cookieAccessName, 'a1');
    const { POST } = await import('@/app/api/auth/logout/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/auth/logout', {
        method: 'POST',
        headers: originHeaders(),
        body: '{}',
      }),
    );
    expect(response.status).toBe(204);
    const setCookie = (response.headers.getSetCookie?.() ?? []).join(';');
    expect(setCookie).toContain(sessionConfig.cookieAccessName);
    expect(setCookie).toContain(sessionConfig.cookieRefreshName);
    expect(setCookie).toMatch(/Max-Age=0|max-age=0/i);
  });
});
