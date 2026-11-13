/**
 * @jest-environment node
 */

const getSessionMock = jest.fn();

jest.mock('@/lib/auth/session', () => ({
  getSession: () => getSessionMock(),
}));

describe('GET /api/health', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    getSessionMock.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('no session returns 401', async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('hospital session returns 403', async () => {
    getSessionMock.mockResolvedValue({
      id: '1',
      displayName: 'H',
      email: 'h@example.test',
      kind: 'HOSPITAL',
      hospitalName: 'X',
      activeBranchId: null,
      activeBranchName: null,
      roleCodes: [],
      mustChangePassword: false,
    });
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'FORBIDDEN' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('HQ session returns only the allowed status field', async () => {
    getSessionMock.mockResolvedValue({
      id: 'hq-1',
      displayName: 'Admin',
      email: 'hq@example.test',
      kind: 'HQ',
      hospitalName: null,
      activeBranchId: null,
      activeBranchName: null,
      roleCodes: ['HQ_ADMIN'],
      mustChangePassword: false,
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'ok',
        postgres: 'up',
        redis: 'up',
        storage: { ok: true, path: '/secret' },
        extras: 'must-not-leak',
      }),
    });
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
    expect(Object.keys(body)).toEqual(['status']);
    expect(JSON.stringify(body)).not.toMatch(/postgres|redis|storage|extras|secret/i);
  });
});
