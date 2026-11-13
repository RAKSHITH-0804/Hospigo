/**
 * @jest-environment node
 */
import { sessionConfig } from '@/config/session';
import { clearRefreshFlightsForTests, refreshFlightKey } from './refresh-flight';
import { sanitizePatientNextPath } from './http';

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

describe('patient auth route handlers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockCookiesStore.clear();
    clearRefreshFlightsForTests();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('request-otp success returns ok + resendAfterSec only', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true, resendAfterSec: 30 }),
    });
    const { POST } = await import('@/app/api/patient-auth/request-otp/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/request-otp', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ phone: '9876543210' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resendAfterSec: 30 });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('request-otp maps 401/429/503', async () => {
    const { POST } = await import('@/app/api/patient-auth/request-otp/route');
    for (const [status, code] of [
      [401, 'INVALID_CREDENTIALS'],
      [429, 'RATE_LIMITED'],
      [503, 'UNAVAILABLE'],
    ] as const) {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status,
        headers: new Headers(status === 429 ? { 'retry-after': '12' } : undefined),
        json: async () => ({}),
      });
      const response = await POST(
        new Request('http://127.0.0.1:3001/api/patient-auth/request-otp', {
          method: 'POST',
          headers: originHeaders(),
          body: JSON.stringify({ phone: '9876543210' }),
        }),
      );
      expect(response.status).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
  });

  it('verify-otp sets both patient cookies and returns { ok: true } without tokens', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'patient-access-secret',
        refreshToken: 'p.session.secret',
        expiresIn: 900,
      }),
    });
    const { POST } = await import('@/app/api/patient-auth/verify-otp/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/verify-otp', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ phone: '9876543210', code: '123456' }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ ok: true });
    expect(JSON.stringify(json)).not.toMatch(/accessToken|refreshToken|patient-access|p\.session/i);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const blob = setCookie.join(';');
    expect(blob).toContain(sessionConfig.patientCookieAccessName);
    expect(blob).toContain(sessionConfig.patientCookieRefreshName);
    expect(blob.toLowerCase()).toContain('httponly');
    expect(blob).toContain(`Path=${sessionConfig.patientRefreshCookiePath}`);
    expect(blob).not.toContain(sessionConfig.cookieAccessName + '=');
    expect(blob).not.toContain(`${sessionConfig.cookieRefreshName}=`);
  });

  it('refuses bad Origin, wrong content type, and oversized body', async () => {
    const { POST } = await import('@/app/api/patient-auth/request-otp/route');
    const badOrigin = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/request-otp', {
        method: 'POST',
        headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210' }),
      }),
    );
    expect(badOrigin.status).toBe(403);

    const badCt = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/request-otp', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:3001', 'Content-Type': 'text/plain' },
        body: 'phone=1',
      }),
    );
    expect(badCt.status).toBe(415);

    const huge = 'x'.repeat(sessionConfig.bodyLimitBytes + 1);
    const tooBig = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/request-otp', {
        method: 'POST',
        headers: originHeaders(),
        body: huge,
      }),
    );
    expect(tooBig.status).toBe(413);
  });

  it('maps upstream timeout/network failure to 503', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('aborted'));
    const { POST } = await import('@/app/api/patient-auth/request-otp/route');
    const response = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/request-otp', {
        method: 'POST',
        headers: originHeaders(),
        body: JSON.stringify({ phone: '9876543210' }),
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('UNAVAILABLE');
  });

  it('refresh success sets cookies and redirects to sanitized /patient next', async () => {
    mockCookiesStore.set(sessionConfig.patientCookieRefreshName, 'p.old.secret');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        accessToken: 'new-access',
        refreshToken: 'p.new.secret',
        expiresIn: 900,
      }),
    });
    const { GET } = await import('@/app/api/patient-auth/refresh/route');
    const response = await GET(
      new Request('http://127.0.0.1:3001/api/patient-auth/refresh?next=%2Fpatient%2Fhome', {
        method: 'GET',
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe('http://127.0.0.1:3001/patient/home');
    const blob = (response.headers.getSetCookie?.() ?? []).join(';');
    expect(blob).toContain(sessionConfig.patientCookieAccessName);
    expect(blob).toContain('p.new.secret');
  });

  it('refresh failure clears patient cookies and redirects to patient login', async () => {
    mockCookiesStore.set(sessionConfig.patientCookieRefreshName, 'p.bad.secret');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({}),
    });
    const { GET } = await import('@/app/api/patient-auth/refresh/route');
    const response = await GET(
      new Request('http://127.0.0.1:3001/api/patient-auth/refresh?next=/patient', {
        method: 'GET',
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(
      `http://127.0.0.1:3001${sessionConfig.patientLoginPath}`,
    );
    const blob = (response.headers.getSetCookie?.() ?? []).join(';').toLowerCase();
    expect(blob).toMatch(/max-age=0/);
  });

  it('sanitizePatientNextPath rejects external, protocol-relative, and non-patient paths', () => {
    const fallback = '/patient';
    expect(sanitizePatientNextPath('https://evil.test', fallback)).toBe(fallback);
    expect(sanitizePatientNextPath('//evil.test', fallback)).toBe(fallback);
    expect(sanitizePatientNextPath('/admin', fallback)).toBe(fallback);
    expect(sanitizePatientNextPath('/app', fallback)).toBe(fallback);
    expect(sanitizePatientNextPath('/patient-evil', fallback)).toBe(fallback);
    expect(sanitizePatientNextPath('/patient', fallback)).toBe('/patient');
    expect(sanitizePatientNextPath('/patient/x', fallback)).toBe('/patient/x');
  });

  it('logout clears cookies and returns ok even when upstream fails or cookie missing', async () => {
    const { POST } = await import('@/app/api/patient-auth/logout/route');
    const noCookie = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/logout', {
        method: 'POST',
        headers: originHeaders(),
        body: '{}',
      }),
    );
    expect(noCookie.status).toBe(200);
    expect(await noCookie.json()).toEqual({ ok: true });

    mockCookiesStore.set(sessionConfig.patientCookieRefreshName, 'p.x.y');
    (global.fetch as jest.Mock).mockRejectedValue(new Error('down'));
    const withCookie = await POST(
      new Request('http://127.0.0.1:3001/api/patient-auth/logout', {
        method: 'POST',
        headers: originHeaders(),
        body: '{}',
      }),
    );
    expect(withCookie.status).toBe(200);
    expect(await withCookie.json()).toEqual({ ok: true });
    const blob = (withCookie.headers.getSetCookie?.() ?? []).join(';').toLowerCase();
    expect(blob).toMatch(/max-age=0/);
  });

  it('patient refresh flight key differs from staff for the same token string', () => {
    const token = 'same-token-value';
    expect(refreshFlightKey(token, 'patient')).not.toBe(refreshFlightKey(token, 'staff'));
  });
});

describe('patient vs staff cookies', () => {
  it('patient refresh path does not equal or prefix-overlap staff path; names differ', () => {
    expect(sessionConfig.patientRefreshCookiePath).not.toBe(sessionConfig.refreshCookiePath);
    expect(
      sessionConfig.patientRefreshCookiePath.startsWith(`${sessionConfig.refreshCookiePath}/`),
    ).toBe(false);
    expect(
      sessionConfig.refreshCookiePath.startsWith(`${sessionConfig.patientRefreshCookiePath}/`),
    ).toBe(false);
    expect(sessionConfig.patientCookieAccessName).not.toBe(sessionConfig.cookieAccessName);
    expect(sessionConfig.patientCookieRefreshName).not.toBe(sessionConfig.cookieRefreshName);
  });
});
