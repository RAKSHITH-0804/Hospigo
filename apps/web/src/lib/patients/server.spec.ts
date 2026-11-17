/**
 * @jest-environment node
 */

const callStaffApiMock = jest.fn();
const redirectToRefreshMock = jest.fn(async () => {
  throw new Error('REDIRECT:/api/auth/refresh');
});

jest.mock('@/lib/auth/staff-api', () => ({
  callStaffApi: (...args: unknown[]) => callStaffApiMock(...args),
}));
jest.mock('@/lib/auth/guards', () => ({
  redirectToRefresh: () => redirectToRefreshMock(),
}));

import { fetchStaffOnServer } from './server';

describe('fetchStaffOnServer', () => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    redirectToRefreshMock.mockClear();
  });

  it('returns data on success and sends a GET with the query', async () => {
    callStaffApiMock.mockResolvedValue({ ok: true, data: { items: [] } });
    await expect(fetchStaffOnServer('/patients', { q: 'ab' })).resolves.toEqual({
      status: 'ok',
      data: { items: [] },
    });
    expect(callStaffApiMock).toHaveBeenCalledWith('/patients', {
      method: 'GET',
      query: { q: 'ab' },
    });
  });

  it('redirects to the refresh route on an upstream 401', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 401 });
    await expect(fetchStaffOnServer('/patients')).rejects.toThrow('REDIRECT:/api/auth/refresh');
    expect(redirectToRefreshMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, { status: 'forbidden' }],
    [404, { status: 'notFound' }],
    [503, { status: 'error', code: 'UNAVAILABLE' }],
    [500, { status: 'error', code: 'UNKNOWN' }],
  ])('maps upstream %s', async (status, expected) => {
    callStaffApiMock.mockResolvedValue({ ok: false, status });
    await expect(fetchStaffOnServer('/patients')).resolves.toEqual(expected);
  });

  it('keeps fieldErrors from a 400 and drops everything else', async () => {
    callStaffApiMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: { fieldErrors: { q: 'INVALID', bad: 5 }, token: 'x' },
    });
    await expect(fetchStaffOnServer('/patients')).resolves.toEqual({
      status: 'invalid',
      fieldErrors: { q: 'INVALID' },
    });
  });
});
