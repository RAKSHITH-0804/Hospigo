/**
 * @jest-environment node
 */
import { resolveClientIp } from './api-client';

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
