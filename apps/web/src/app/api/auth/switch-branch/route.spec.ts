/**
 * @jest-environment node
 */

const refreshTokensMock = jest.fn();
const switchBranchUpstreamMock = jest.fn();
const mockCookiesStore = new Map<string, string>();

jest.mock('@/lib/auth/api-client', () => ({
  refreshTokens: (...args: unknown[]) => refreshTokensMock(...args),
  switchBranchUpstream: (...args: unknown[]) => switchBranchUpstreamMock(...args),
}));

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookiesStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { sessionConfig } from '@/config/session';
import { clearRefreshFlightsForTests } from '@/lib/auth/refresh-flight';
import { POST as refreshSession } from '../refresh-session/route';
import { POST } from './route';

const ORIGIN = process.env.APP_URL ?? 'http://127.0.0.1:3001';

function switchRequest(body: unknown = { branchId: 'branch-east' }, headers: HeadersInit = {}) {
  return new Request(`${ORIGIN}/api/auth/switch-branch`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function refreshRequest() {
  return new Request(`${ORIGIN}/api/auth/refresh-session`, { method: 'POST' });
}

function setCookies(res: Response): string {
  return (res.headers.getSetCookie?.() ?? []).join(';');
}

/**
 * Stand-in for the API's rotation rules: a refresh token works exactly once; presenting a
 * spent (or unknown) token is REUSE, which in the real API revokes the whole session.
 */
class FakeApi {
  live = 'R0';
  spent = new Set<string>();
  counter = 0;
  reuse = false;
  refreshCalls: string[] = [];
  switchCalls: Array<{ refreshToken: string; branchId: string }> = [];
  switchFailure: { status: number; message?: string; retryAfter?: string } | null = null;

  private async tick() {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  private rotate(token: string): { accessToken: string; refreshToken: string } | null {
    if (token !== this.live || this.spent.has(token)) {
      this.reuse = true;
      return null;
    }
    this.spent.add(token);
    this.counter += 1;
    this.live = `R${this.counter}`;
    return { accessToken: `A${this.counter}`, refreshToken: this.live };
  }

  async refresh(_request: unknown, token: string) {
    this.refreshCalls.push(token);
    await this.tick();
    const next = this.rotate(token);
    return next
      ? { ok: true, data: { ...next, expiresIn: 900, mustChangePassword: false } }
      : { ok: false, status: 401 };
  }

  async switchBranch(
    _request: unknown,
    _access: string,
    body: { branchId: string; refreshToken: string },
  ) {
    this.switchCalls.push(body);
    await this.tick();
    if (this.switchFailure) {
      return { ok: false, ...this.switchFailure };
    }
    const next = this.rotate(body.refreshToken);
    return next
      ? { ok: true, data: { ...next, expiresIn: 900, mustChangePassword: false } }
      : { ok: false, status: 401 };
  }
}

describe('POST /api/auth/switch-branch', () => {
  let api: FakeApi;

  beforeEach(() => {
    mockCookiesStore.clear();
    clearRefreshFlightsForTests();
    refreshTokensMock.mockReset();
    switchBranchUpstreamMock.mockReset();
    api = new FakeApi();
    refreshTokensMock.mockImplementation((...a: [unknown, string]) => api.refresh(...a));
    switchBranchUpstreamMock.mockImplementation(
      (...a: [unknown, string, { branchId: string; refreshToken: string }]) =>
        api.switchBranch(...a),
    );
    mockCookiesStore.set(sessionConfig.cookieRefreshName, 'R0');
  });

  describe('request checks', () => {
    it('refuses a missing or foreign Origin (403) and a non-JSON body (415)', async () => {
      const noOrigin = new Request(`${ORIGIN}/x`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect((await POST(noOrigin)).status).toBe(403);
      expect((await POST(switchRequest({}, { Origin: 'https://evil.example' }))).status).toBe(403);
      const text = new Request(`${ORIGIN}/x`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
        body: 'x',
      });
      expect((await POST(text)).status).toBe(415);
      expect(refreshTokensMock).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ branchId: '' }], [{ branchId: 5 }], [{ branchId: 'x'.repeat(65) }], [null]])(
      'rejects a bad branchId %j with 400 and never calls the API',
      async (body) => {
        const res = await POST(switchRequest(body));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ ok: false, code: 'VALIDATION' });
        expect(refreshTokensMock).not.toHaveBeenCalled();
        expect(switchBranchUpstreamMock).not.toHaveBeenCalled();
      },
    );

    it('without a refresh cookie: 401, cookies cleared, API untouched', async () => {
      mockCookiesStore.delete(sessionConfig.cookieRefreshName);
      const res = await POST(switchRequest());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, code: 'SESSION_EXPIRED' });
      expect(setCookies(res)).toMatch(/Max-Age=0/i);
      expect(refreshTokensMock).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('renews the session, switches, sets the new cookies and returns no token in the body', async () => {
      const res = await POST(switchRequest());
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('location')).toBeNull();
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(JSON.stringify(json)).not.toMatch(/token|A\d|R\d/i);
      const cookies = setCookies(res);
      expect(cookies).toContain('A2');
      expect(cookies).toContain('R2');
      expect(cookies).toMatch(/HttpOnly/i);
      // Refresh once with the cookie token, then switch with the ROTATED token.
      expect(api.refreshCalls).toEqual(['R0']);
      expect(api.switchCalls).toEqual([{ branchId: 'branch-east', refreshToken: 'R1' }]);
      expect(api.reuse).toBe(false);
    });
  });

  describe('refused switch still hands over the rotated session', () => {
    it.each([
      [403, undefined, 403, 'FORBIDDEN'],
      [404, undefined, 404, 'BRANCH_NOT_AVAILABLE'],
      [400, 'Branch is already active', 400, 'SAME_BRANCH'],
      [400, 'something else', 400, 'VALIDATION'],
      [503, undefined, 503, 'UNAVAILABLE'],
      [502, undefined, 502, 'UNAVAILABLE'],
      [418, undefined, 500, 'UNKNOWN'],
    ])('upstream %s (%s) -> %s %s with the refresh step cookies', async (up, msg, status, code) => {
      api.switchFailure = { status: up, message: msg };
      const res = await POST(switchRequest());
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ ok: false, code });
      // The refresh step spent R0: the browser MUST get R1, or its next refresh looks like reuse.
      const cookies = setCookies(res);
      expect(cookies).toContain('R1');
      expect(cookies).toContain('A1');
    });

    it('429 forwards Retry-After', async () => {
      api.switchFailure = { status: 429, retryAfter: '30' };
      const res = await POST(switchRequest());
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('30');
      expect(await res.json()).toEqual({ ok: false, code: 'RATE_LIMITED' });
    });

    it('upstream 401 on the switch means the session is gone: cookies cleared, none re-issued', async () => {
      api.switchFailure = { status: 401 };
      const res = await POST(switchRequest());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, code: 'SESSION_EXPIRED' });
      const cookies = setCookies(res);
      expect(cookies).toMatch(/Max-Age=0/i);
      expect(cookies).not.toContain('R1');
    });

    it('a dead refresh token (401 on the renewal step) clears cookies', async () => {
      mockCookiesStore.set(sessionConfig.cookieRefreshName, 'spent-token');
      const res = await POST(switchRequest());
      expect(res.status).toBe(401);
      expect(setCookies(res)).toMatch(/Max-Age=0/i);
      expect(switchBranchUpstreamMock).not.toHaveBeenCalled();
    });
  });

  describe('single-flight with silent renewal (no reuse, one answer)', () => {
    it('a switch and a refresh at the same time (switch first): API sees each token once, cookies agree', async () => {
      const [sw, rf] = await Promise.all([POST(switchRequest()), refreshSession(refreshRequest())]);
      expect(api.reuse).toBe(false);
      expect(api.refreshCalls).toEqual(['R0']);
      expect(api.switchCalls).toHaveLength(1);
      expect(sw.status).toBe(200);
      expect(rf.status).toBe(200);
      // Both responses end with the SAME, newest tokens (neither writes a spent one).
      for (const res of [sw, rf]) {
        expect(setCookies(res)).toContain('R2');
        expect(setCookies(res)).not.toContain('R1');
      }
    });

    it('a switch and a refresh at the same time (refresh first): the switch continues from the rotated token', async () => {
      const [rf, sw] = await Promise.all([refreshSession(refreshRequest()), POST(switchRequest())]);
      expect(api.reuse).toBe(false);
      expect(api.refreshCalls).toEqual(['R0']);
      expect(api.switchCalls).toEqual([{ branchId: 'branch-east', refreshToken: 'R1' }]);
      expect(rf.status).toBe(200);
      expect(sw.status).toBe(200);
      for (const res of [rf, sw]) {
        expect(setCookies(res)).toContain('R2');
        expect(setCookies(res)).not.toContain('R1');
      }
    });

    it('many refreshes around one switch: the API is called once per token, all answers agree', async () => {
      const results = await Promise.all([
        refreshSession(refreshRequest()),
        POST(switchRequest()),
        refreshSession(refreshRequest()),
        refreshSession(refreshRequest()),
      ]);
      expect(api.reuse).toBe(false);
      expect(api.refreshCalls).toEqual(['R0']);
      expect(api.switchCalls).toHaveLength(1);
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(setCookies(res)).toContain('R2');
      }
    });

    it('a double click (same target twice) is one switch', async () => {
      const [a, b] = await Promise.all([POST(switchRequest()), POST(switchRequest())]);
      expect(api.reuse).toBe(false);
      expect(api.switchCalls).toHaveLength(1);
      expect([a.status, b.status]).toEqual([200, 200]);
    });

    it('two switches to DIFFERENT branches at once: one runs, the other is refused (409)', async () => {
      const [a, b] = await Promise.all([
        POST(switchRequest({ branchId: 'branch-east' })),
        POST(switchRequest({ branchId: 'branch-west' })),
      ]);
      expect(api.reuse).toBe(false);
      expect(api.switchCalls).toHaveLength(1);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const refused = a.status === 409 ? a : b;
      expect(await refused.json()).toEqual({ ok: false, code: 'SWITCH_IN_PROGRESS' });
    });

    it('a refused switch next to a refresh still ends with one consistent cookie', async () => {
      api.switchFailure = { status: 404 };
      const [sw, rf] = await Promise.all([POST(switchRequest()), refreshSession(refreshRequest())]);
      expect(api.reuse).toBe(false);
      expect(sw.status).toBe(404);
      expect(rf.status).toBe(200);
      expect(setCookies(rf)).toContain('R1');
      expect(setCookies(sw)).toContain('R1');
    });
  });
});
