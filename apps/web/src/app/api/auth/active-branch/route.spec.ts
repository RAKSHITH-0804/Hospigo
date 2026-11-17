/**
 * @jest-environment node
 */

let accessCookie: string | undefined;

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      accessCookie !== undefined && name === 'hospigo_access' ? { value: accessCookie } : undefined,
  }),
}));

import { GET } from './route';

function tokenFor(payload: unknown): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
}

describe('GET /api/auth/active-branch', () => {
  beforeEach(() => {
    accessCookie = undefined;
  });

  it('returns the branch id held by the shared cookie, with no token in the body', async () => {
    accessCookie = tokenFor({ branchId: 'branch-7', userId: 'u1' });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json).toEqual({ activeBranchId: 'branch-7' });
    expect(JSON.stringify(json)).not.toContain(accessCookie);
  });

  it.each([
    ['no cookie', undefined],
    ['a cookie that is not a JWT', 'garbage'],
    ['a payload without a branch', tokenFor({ userId: 'u1' })],
    ['a payload that is not JSON', 'h.%%%.s'],
    ['a non-string branch', tokenFor({ branchId: 7 })],
  ])('returns null for %s (never an error, never a reload trigger)', async (_n, value) => {
    accessCookie = value;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeBranchId: null });
  });
});
