/**
 * @jest-environment node
 */
import { callApi, resolveClientIp } from './api-client';
import { sessionConfig } from '@/config/session';

function requestWith(headers: Record<string, string>, socketIp?: string): Request {
  const request = new Request('http://127.0.0.1:3001/api/auth/hospital-login', {
    method: 'POST',
    headers,
  });
  if (socketIp !== undefined) {
    Object.defineProperty(request, 'socket', {
      value: { remoteAddress: socketIp },
    });
  }
  return request;
}

describe('resolveClientIp / WEB_TRUST_FORWARDED_HEADERS', () => {
  it('when trust is false, ignores x-forwarded-for and x-real-ip and uses socket only', () => {
    const request = requestWith(
      {
        'x-forwarded-for': '198.51.100.10, 10.0.0.1',
        'x-real-ip': '203.0.113.1',
      },
      '10.0.0.55',
    );
    expect(resolveClientIp(request, false)).toBe('10.0.0.55');
  });

  it('when trust is false and there is no socket, returns undefined even with spoofed headers', () => {
    const request = requestWith({
      'x-forwarded-for': '198.51.100.10',
      'x-real-ip': '203.0.113.1',
    });
    expect(resolveClientIp(request, false)).toBeUndefined();
  });

  it('when trust is true, honours x-forwarded-for first hop', () => {
    const request = requestWith(
      {
        'x-forwarded-for': '198.51.100.10, 10.0.0.1',
        'x-real-ip': '203.0.113.1',
      },
      '10.0.0.55',
    );
    expect(resolveClientIp(request, true)).toBe('198.51.100.10');
  });

  it('when trust is true and x-forwarded-for is absent, uses x-real-ip then socket', () => {
    const withRealIp = requestWith({ 'x-real-ip': '203.0.113.9' }, '10.0.0.55');
    expect(resolveClientIp(withRealIp, true)).toBe('203.0.113.9');
    const socketOnly = requestWith({}, '10.0.0.55');
    expect(resolveClientIp(socketOnly, true)).toBe('10.0.0.55');
  });
});

describe('callApi error body parsing', () => {
  const originalFetch = global.fetch;
  const originalApi = process.env.API_INTERNAL_URL;

  beforeEach(() => {
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:3999';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.API_INTERNAL_URL = originalApi;
  });

  it('keeps JSON 409 object body with code and matches', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'POSSIBLE_DUPLICATE',
          matches: [{ id: '1', uhid: 'U1', name: 'A' }],
          message: 'dup',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await callApi(new Request('http://127.0.0.1:3001/'), '/patients', {
      method: 'POST',
      json: { name: 'A' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.body?.code).toBe('POSSIBLE_DUPLICATE');
      expect(result.body?.matches).toEqual([{ id: '1', uhid: 'U1', name: 'A' }]);
      expect(result.message).toBe('dup');
    }
  });

  it('ignores non-JSON error bodies', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('<html>error</html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const result = await callApi(new Request('http://127.0.0.1:3001/'), '/patients');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body).toBeUndefined();
      expect(result.message).toBeUndefined();
    }
  });

  it('drops oversized error bodies over the config cap', async () => {
    const oversized = 'x'.repeat(sessionConfig.staffUpstreamErrorBodyMaxBytes + 10);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(`{"code":"X","pad":"${oversized}"}`, {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await callApi(new Request('http://127.0.0.1:3001/'), '/patients');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body).toBeUndefined();
    }
  });

  it('success path returns data without body field', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await callApi(new Request('http://127.0.0.1:3001/'), '/patients/1');
    expect(result).toEqual({ ok: true, data: { id: 'ok' }, retryAfter: undefined });
  });
});
