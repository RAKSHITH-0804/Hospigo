/**
 * @jest-environment node
 */
import {
  clearRefreshFlightsForTests,
  flightTokens,
  runRefreshSingleFlight,
  type FlightResult,
} from './refresh-flight';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (refreshToken: string): FlightResult => ({
  ok: true,
  data: { accessToken: `a-${refreshToken}`, refreshToken, expiresIn: 900 },
});

describe('runRefreshSingleFlight', () => {
  beforeEach(() => clearRefreshFlightsForTests());

  it('shares one upstream call between concurrent refreshes of one token', async () => {
    const fn = jest.fn(async () => {
      await sleep(10);
      return ok('R1');
    });
    const results = await Promise.all([
      runRefreshSingleFlight('R0', fn),
      runRefreshSingleFlight('R0', fn),
      runRefreshSingleFlight('R0', fn),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(flightTokens(r)?.refreshToken).toBe('R1');
    }
  });

  it('keeps staff and patient flights apart', async () => {
    const fn = jest.fn(async () => ok('R1'));
    await Promise.all([
      runRefreshSingleFlight('R0', fn, 'staff'),
      runRefreshSingleFlight('R0', fn, 'patient'),
    ]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a switch queued behind a running refresh continues from the ROTATED tokens (start)', async () => {
    const refreshFn = jest.fn(async () => {
      await sleep(10);
      return ok('R1');
    });
    const switchFn = jest.fn(async (start?: { refreshToken?: string }) =>
      ok(`switched-from-${start?.refreshToken}`),
    );
    const [refreshResult, switchResult] = await Promise.all([
      runRefreshSingleFlight('R0', refreshFn),
      runRefreshSingleFlight('R0', switchFn, 'staff', 'switch:b1'),
    ]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(switchFn).toHaveBeenCalledTimes(1);
    expect(switchFn.mock.calls[0]?.[0]?.refreshToken).toBe('R1');
    // The refresh ends with the switch's newest tokens, not the spent R1.
    expect(flightTokens(refreshResult)?.refreshToken).toBe('switched-from-R1');
    expect(flightTokens(switchResult)?.refreshToken).toBe('switched-from-R1');
  });

  it('a refresh that arrives while a switch runs joins it and gets the switch tokens', async () => {
    const switchFn = jest.fn(async () => {
      await sleep(10);
      return ok('R2');
    });
    const refreshFn = jest.fn(async () => ok('SHOULD-NOT-RUN'));
    const [s, r] = await Promise.all([
      runRefreshSingleFlight('R0', switchFn, 'staff', 'switch:b1'),
      runRefreshSingleFlight('R0', refreshFn),
    ]);
    expect(refreshFn).not.toHaveBeenCalled();
    expect(flightTokens(s)?.refreshToken).toBe('R2');
    expect(flightTokens(r)?.refreshToken).toBe('R2');
  });

  it('the same switch twice is one call; a different switch gets 409', async () => {
    const fn = jest.fn(async () => {
      await sleep(10);
      return ok('R1');
    });
    const other = jest.fn(async () => ok('X'));
    const [a, b, c] = await Promise.all([
      runRefreshSingleFlight('R0', fn, 'staff', 'switch:b1'),
      runRefreshSingleFlight('R0', fn, 'staff', 'switch:b1'),
      runRefreshSingleFlight('R0', other, 'staff', 'switch:b2'),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(a.ok && b.ok).toBe(true);
    expect(c).toEqual({ ok: false, status: 409 });
  });

  it('two different switches queued behind one refresh: the second is refused, the first still wins', async () => {
    const refreshFn = async () => {
      await sleep(10);
      return ok('R1');
    };
    const sw1 = jest.fn(async () => ok('R2'));
    const sw2 = jest.fn(async () => ok('R2b'));
    const [, a, b] = await Promise.all([
      runRefreshSingleFlight('R0', refreshFn),
      runRefreshSingleFlight('R0', sw1, 'staff', 'switch:b1'),
      runRefreshSingleFlight('R0', sw2, 'staff', 'switch:b2'),
    ]);
    expect(sw1).toHaveBeenCalledTimes(1);
    expect(sw2).not.toHaveBeenCalled();
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, status: 409 });
  });

  it('a failed refresh is returned to the queued switch (it never calls the API)', async () => {
    const refreshFn = async (): Promise<FlightResult> => {
      await sleep(5);
      return { ok: false, status: 401 };
    };
    const switchFn = jest.fn(async () => ok('R2'));
    const [, s] = await Promise.all([
      runRefreshSingleFlight('R0', refreshFn),
      runRefreshSingleFlight('R0', switchFn, 'staff', 'switch:b1'),
    ]);
    expect(switchFn).not.toHaveBeenCalled();
    expect(s).toEqual({ ok: false, status: 401 });
  });

  it('flightTokens reads rotated tokens from a refused switch and nothing from a dead session', () => {
    const refused: FlightResult = {
      ok: false,
      status: 404,
      tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 1 },
    };
    expect(flightTokens(refused)?.refreshToken).toBe('r');
    expect(flightTokens({ ok: false, status: 401 })).toBeUndefined();
  });
});
