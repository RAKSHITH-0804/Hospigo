import {
  clearClientRefreshLatchForTests,
  patientsApi,
  refreshSessionOnce,
} from '@/lib/patients/client';

const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe('patientsApi silent refresh', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    clearClientRefreshLatchForTests();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('retries once after a successful refresh-session', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_EXPIRED' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }));

    const result = await patientsApi<{ id: string }>('/api/staff/patients/p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('p1');
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/auth/refresh-session');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
  });

  it('does not loop when the retry also returns 401', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_EXPIRED' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ code: 'SESSION_EXPIRED' }, 401));

    const result = await patientsApi('/api/staff/patients/p1');
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('concurrent 401s trigger ONE refresh call', async () => {
    let refreshCount = 0;
    let resolveRefresh: ((value: ReturnType<typeof jsonResponse>) => void) | undefined;
    const refreshGate = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveRefresh = resolve;
    });
    const attempts = new Map<string, number>();

    fetchMock.mockImplementation(async (url: string) => {
      const key = String(url);
      if (key.includes('/api/auth/refresh-session')) {
        refreshCount += 1;
        return refreshGate;
      }
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n === 1) {
        return jsonResponse({ code: 'SESSION_EXPIRED' }, 401);
      }
      return jsonResponse({ ok: true });
    });

    const a = patientsApi('/api/staff/patients/a');
    const b = patientsApi('/api/staff/patients/b');
    for (let i = 0; i < 40 && refreshCount === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(refreshCount).toBe(1);
    resolveRefresh?.(jsonResponse({ ok: true }));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(refreshCount).toBe(1);
  });

  it('refreshSessionOnce shares one in-flight promise', async () => {
    let resolveRefresh: ((value: ReturnType<typeof jsonResponse>) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const p1 = refreshSessionOnce();
    const p2 = refreshSessionOnce();
    expect(p1).toBe(p2);
    resolveRefresh?.(jsonResponse({ ok: true }));
    expect(await p1).toBe(true);
  });
});
