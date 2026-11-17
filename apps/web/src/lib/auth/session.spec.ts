/**
 * @jest-environment node
 */

const fetchMeMock = jest.fn();

// React's cache() only memoizes inside a server render. This stand-in memoizes per
// "request" so the test can prove layout + page + guard share ONE /auth/me.
let requestScope = new Map<unknown, unknown>();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      if (!requestScope.has(fn)) {
        requestScope.set(fn, fn(...args));
      }
      return requestScope.get(fn);
    },
}));

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hospigo_access' ? { value: 'access-token' } : undefined),
  }),
  headers: async () => ({ get: () => null }),
}));

jest.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
}));

jest.mock('./api-client', () => ({
  fetchMe: (...args: unknown[]) => fetchMeMock(...args),
}));

import { requireKind, requirePermission } from './guards';
import { getSession } from './session';

const profile = { id: 'u1', kind: 'HOSPITAL', permissions: ['patients.registry.read'] };

describe('one session lookup per navigation', () => {
  beforeEach(() => {
    requestScope = new Map();
    fetchMeMock.mockReset();
    fetchMeMock.mockResolvedValue({ ok: true, data: profile });
  });

  it('layout guard + page guard + getSession share a single /auth/me', async () => {
    await requireKind('HOSPITAL'); // layout
    await requirePermission('patients.registry.read'); // page
    await getSession(); // any other reader in the same render
    expect(fetchMeMock).toHaveBeenCalledTimes(1);
  });

  it('a new request looks the session up again (nothing is shared across requests)', async () => {
    await requireKind('HOSPITAL');
    requestScope = new Map();
    await requireKind('HOSPITAL');
    expect(fetchMeMock).toHaveBeenCalledTimes(2);
  });
});
