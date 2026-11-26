import { terminologyConfig } from '@/config/terminology';
import { clearTermsCacheForTests, hospitalTerms, termOr } from '@/lib/terminology/server';

const callMock = jest.fn();
jest.mock('@/lib/auth/staff-api', () => ({ callStaffApi: (...a: unknown[]) => callMock(...a) }));

describe('hospital terminology lookup', () => {
  beforeEach(() => {
    callMock.mockReset();
    clearTermsCacheForTests();
    jest.useRealTimers();
  });

  it("returns the hospital's words and keeps them for a short time (one call, not one per page)", async () => {
    callMock.mockResolvedValue({ ok: true, data: { items: { patients: 'Clients' } } });
    expect(await hospitalTerms('u1')).toEqual({ patients: 'Clients' });
    expect(await hospitalTerms('u1')).toEqual({ patients: 'Clients' });
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock.mock.calls[0]![0]).toBe('/terminology');
  });

  it('asks again after the cache time, and keeps hospitals apart', async () => {
    jest.useFakeTimers();
    callMock.mockResolvedValue({ ok: true, data: { items: { queue: 'Waiting line' } } });
    await hospitalTerms('u1');
    await hospitalTerms('u2');
    expect(callMock).toHaveBeenCalledTimes(2);
    jest.setSystemTime(Date.now() + terminologyConfig.cacheSeconds * 1000 + 1);
    await hospitalTerms('u1');
    expect(callMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to no overrides when the call fails, and termOr falls back to the standard word', async () => {
    callMock.mockResolvedValue({ ok: false, status: 502 });
    expect(await hospitalTerms('u1')).toEqual({});
    expect(termOr({}, 'patients', 'Patients')).toBe('Patients');
    expect(termOr({ patients: '  ' }, 'patients', 'Patients')).toBe('Patients');
    expect(termOr({ patients: 'Clients' }, 'patients', 'Patients')).toBe('Clients');
  });
});
