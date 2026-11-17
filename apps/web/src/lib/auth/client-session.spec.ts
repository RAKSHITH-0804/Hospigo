import { staffCopy } from '@/config/staff-copy';
import {
  branchErrorMessageFor,
  clearClientRefreshLatchForTests,
  fetchCookieBranchId,
  fetchSwitchableBranches,
  getClientActiveBranch,
  refreshSessionOnce,
  setClientActiveBranch,
  switchBranchOnce,
} from '@/lib/auth/client-session';
import { errorMessageFor, patientsApi } from '@/lib/patients/client';

const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** A promise the test resolves by hand, to hold a request "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function urlOf(call: unknown[]): string {
  return String(call[0]);
}

describe('client session helpers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    clearClientRefreshLatchForTests();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('active branch of this tab', () => {
    it('remembers and clears the branch the page was rendered for', () => {
      expect(getClientActiveBranch()).toBeUndefined();
      setClientActiveBranch('b1');
      expect(getClientActiveBranch()).toBe('b1');
      setClientActiveBranch(null);
      expect(getClientActiveBranch()).toBeUndefined();
    });
  });

  describe('stale-tab guard header on writes (patientsApi)', () => {
    it('sends the page branch on writes and not on reads', async () => {
      setClientActiveBranch('b1');
      fetchMock.mockResolvedValue(jsonResponse({ id: 'p1' }));
      await patientsApi('/api/staff/patients', { method: 'POST', body: { name: 'A' } });
      await patientsApi('/api/staff/patients/p1', { method: 'PATCH', body: { name: 'B' } });
      await patientsApi('/api/staff/patients/uhid/start-number', { method: 'PUT', body: {} });
      await patientsApi('/api/staff/patients/p1');
      const headersOf = (i: number) => (fetchMock.mock.calls[i]?.[1] as RequestInit).headers;
      expect(headersOf(0)).toMatchObject({ 'x-hospigo-branch': 'b1' });
      expect(headersOf(1)).toMatchObject({ 'x-hospigo-branch': 'b1' });
      expect(headersOf(2)).toMatchObject({ 'x-hospigo-branch': 'b1' });
      expect(headersOf(3)).not.toHaveProperty('x-hospigo-branch');
    });

    it('surfaces BRANCH_CHANGED with its own message and does not retry or refresh', async () => {
      setClientActiveBranch('b1');
      fetchMock.mockResolvedValue(jsonResponse({ code: 'BRANCH_CHANGED' }, 409));
      const result = await patientsApi('/api/staff/patients', { method: 'POST', body: {} });
      expect(result).toMatchObject({ ok: false, status: 409, code: 'BRANCH_CHANGED' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(errorMessageFor('BRANCH_CHANGED')).toBe(staffCopy.errors.branchChanged);
    });
  });

  describe('refreshSessionOnce', () => {
    it('shares one request between concurrent callers', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const [a, b] = await Promise.all([refreshSessionOnce(), refreshSessionOnce()]);
      expect([a, b]).toEqual([true, true]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('switchBranchOnce', () => {
    it('posts only the branch id with cookies and reports success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const result = await switchBranchOnce('b2');
      expect(result).toEqual({ ok: true });
      expect(urlOf(fetchMock.mock.calls[0]!)).toBe('/api/auth/switch-branch');
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(JSON.parse(String(init.body))).toEqual({ branchId: 'b2' });
    });

    it.each([
      [403, 'FORBIDDEN'],
      [404, 'BRANCH_NOT_AVAILABLE'],
      [400, 'SAME_BRANCH'],
      [409, 'SWITCH_IN_PROGRESS'],
      [401, 'SESSION_EXPIRED'],
    ])('maps a %s answer to %s', async (status, code) => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: false, code }, status));
      expect(await switchBranchOnce('b2')).toEqual({ ok: false, code });
    });

    it('treats a network failure or an unknown body as UNAVAILABLE / UNKNOWN', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect(await switchBranchOnce('b2')).toEqual({ ok: false, code: 'UNAVAILABLE' });
      fetchMock.mockResolvedValueOnce(jsonResponse({ nonsense: true }, 500));
      expect(await switchBranchOnce('b2')).toEqual({ ok: false, code: 'UNKNOWN' });
    });

    it('a second switch to the same branch shares the first; a different one is refused locally', async () => {
      const gate = deferred<ReturnType<typeof jsonResponse>>();
      fetchMock.mockReturnValue(gate.promise);
      const first = switchBranchOnce('b2');
      const same = switchBranchOnce('b2');
      const other = await switchBranchOnce('b3');
      expect(other).toEqual({ ok: false, code: 'SWITCH_IN_PROGRESS' });
      gate.resolve(jsonResponse({ ok: true }));
      expect(await first).toEqual({ ok: true });
      expect(await same).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('waits for a refresh already running in this tab before it posts', async () => {
      const gate = deferred<ReturnType<typeof jsonResponse>>();
      fetchMock.mockReturnValueOnce(gate.promise).mockResolvedValue(jsonResponse({ ok: true }));
      const refresh = refreshSessionOnce();
      const sw = switchBranchOnce('b2');
      // Only the refresh has gone out; the switch holds back.
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(urlOf(fetchMock.mock.calls[0]!)).toContain('/api/auth/refresh-session');
      gate.resolve(jsonResponse({ ok: true }));
      await refresh;
      expect(await sw).toEqual({ ok: true });
      expect(urlOf(fetchMock.mock.calls[1]!)).toBe('/api/auth/switch-branch');
    });

    it('a refresh asked for during a switch waits for the switch instead of sending its own', async () => {
      const gate = deferred<ReturnType<typeof jsonResponse>>();
      fetchMock.mockReturnValue(gate.promise);
      const sw = switchBranchOnce('b2');
      const refresh = refreshSessionOnce();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(urlOf(fetchMock.mock.calls[0]!)).toBe('/api/auth/switch-branch');
      gate.resolve(jsonResponse({ ok: true }));
      expect(await sw).toEqual({ ok: true });
      expect(await refresh).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('lets a new switch start after the previous one finished (latch released)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await switchBranchOnce('b2');
      await switchBranchOnce('b3');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchSwitchableBranches', () => {
    const list = [{ id: 'b1', name: 'Main', isMain: true, isCurrent: true }];

    it('returns the list', async () => {
      fetchMock.mockResolvedValue(jsonResponse(list));
      expect(await fetchSwitchableBranches()).toEqual({ ok: true, branches: list });
    });

    it('renews the session once on 401 and retries', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_EXPIRED' }, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(jsonResponse(list));
      expect(await fetchSwitchableBranches()).toEqual({ ok: true, branches: list });
      expect(urlOf(fetchMock.mock.calls[1]!)).toContain('/api/auth/refresh-session');
    });

    it('does not loop when the retry is also refused', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_EXPIRED' }, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_EXPIRED' }, 401));
      expect(await fetchSwitchableBranches()).toEqual({ ok: false, code: 'SESSION_EXPIRED' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('with no cookies at all (UNAUTHORIZED, renewal refused) reports SESSION_EXPIRED, not a generic error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 'UNAUTHORIZED' }, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: false, code: 'UNAUTHORIZED' }, 401));
      const result = await fetchSwitchableBranches();
      expect(result).toEqual({ ok: false, code: 'SESSION_EXPIRED' });
      expect(branchErrorMessageFor('SESSION_EXPIRED')).toBe(staffCopy.errors.sessionExpired);
    });

    it('reports 403 as FORBIDDEN and a network failure as UNAVAILABLE', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'FORBIDDEN' }, 403));
      expect(await fetchSwitchableBranches()).toEqual({ ok: false, code: 'FORBIDDEN' });
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect(await fetchSwitchableBranches()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    });
  });

  describe('fetchCookieBranchId', () => {
    it('returns the id, and null for anything unusual (never throws)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ activeBranchId: 'b9' }));
      expect(await fetchCookieBranchId()).toBe('b9');
      fetchMock.mockResolvedValueOnce(jsonResponse({ activeBranchId: null }));
      expect(await fetchCookieBranchId()).toBeNull();
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
      expect(await fetchCookieBranchId()).toBeNull();
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect(await fetchCookieBranchId()).toBeNull();
    });
  });

  describe('branchErrorMessageFor', () => {
    it('only ever returns copy from staff-copy', () => {
      const known = Object.values(staffCopy.errors);
      for (const code of [
        'FORBIDDEN',
        'BRANCH_NOT_AVAILABLE',
        'SAME_BRANCH',
        'SWITCH_IN_PROGRESS',
        'SESSION_EXPIRED',
        'RATE_LIMITED',
        'UNAVAILABLE',
        'VALIDATION',
        'UNKNOWN',
        'anything-else',
      ]) {
        expect(known).toContain(branchErrorMessageFor(code));
      }
    });
  });
});
