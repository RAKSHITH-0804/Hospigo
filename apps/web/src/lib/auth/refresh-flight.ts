import { createHash } from 'node:crypto';
import { branchSwitchConfig } from '@/config/branch-switch';
import { sessionConfig } from '@/config/session';

export type RefreshFlightPair = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
};

export type FlightResult =
  | { ok: true; data: RefreshFlightPair }
  | {
      ok: false;
      status: number;
      retryAfter?: string;
      message?: string;
      /**
       * The session was rotated (refresh step) but the operation itself was refused.
       * The browser must still receive these cookies: its old refresh token is already spent.
       */
      tokens?: RefreshFlightPair;
    };

/** What a flight is doing: a plain refresh, or a branch switch (`switch:<branchId>`). */
export const REFRESH_OP = 'refresh';
export type FlightOp = string;

type FlightEntry = {
  op: FlightOp;
  promise: Promise<FlightResult>;
  expiresAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  /**
   * A switch that arrived while this REFRESH was running and continues from its rotated tokens.
   * Set synchronously when the switch arrives, so every refresh on this cookie can end with the
   * switch's (newest) tokens instead of the already-spent ones.
   */
  successor?: Promise<FlightResult>;
  successorOp?: FlightOp;
};

const GLOBAL_FLIGHTS_KEY = '__hospigo_refresh_flights__' as const;

type GlobalWithFlights = typeof globalThis & {
  [GLOBAL_FLIGHTS_KEY]?: Map<string, FlightEntry>;
};

/** Process-wide map so Next dev reloads / split bundles share one single-flight table. */
function flightsMap(): Map<string, FlightEntry> {
  const g = globalThis as GlobalWithFlights;
  if (!g[GLOBAL_FLIGHTS_KEY]) {
    g[GLOBAL_FLIGHTS_KEY] = new Map();
  }
  return g[GLOBAL_FLIGHTS_KEY];
}

/**
 * Single-flight key. Namespace (`staff` | `patient`) is hashed in so staff and
 * patient never share a flight even if token strings somehow collided.
 */
export function refreshFlightKey(
  refreshToken: string,
  namespace: 'staff' | 'patient' = 'staff',
): string {
  return createHash('sha256').update(`${namespace}:${refreshToken}`, 'utf8').digest('hex');
}

/** The session cookies a flight result wants the browser to hold (also after a refused switch). */
export function flightTokens(
  result: FlightResult,
): (RefreshFlightPair & { refreshToken: string }) | undefined {
  const pair = result.ok ? result.data : result.tokens;
  if (!pair?.refreshToken) {
    return undefined;
  }
  return { ...pair, refreshToken: pair.refreshToken };
}

/**
 * Wait for a flight and, if a switch was queued behind it, for that switch too: the caller must
 * end with the NEWEST tokens, never write an already-spent refresh token into the cookie after
 * the switch wrote the new one.
 */
async function settle(entry: FlightEntry): Promise<FlightResult> {
  const first = await entry.promise;
  return entry.successor ? entry.successor : first;
}

/**
 * In-process single-flight: concurrent operations on the same refresh token never reach the
 * API twice with that token (which would look like reuse and revoke the whole session).
 *
 * - same operation: share one upstream call;
 * - a refresh while a switch runs: joins it and ends with the newest tokens (also when the switch
 *   was queued behind a refresh: see `successor`);
 * - a switch while a refresh runs: waits, then continues from the ROTATED tokens
 *   (`fn` receives them as `start`, so it skips its own refresh step);
 * - a switch to a different branch while another switch runs: refused (409).
 *
 * `fn` gets `start` only in the continuation case.
 */
export async function runRefreshSingleFlight(
  refreshToken: string,
  fn: (start?: RefreshFlightPair) => Promise<FlightResult>,
  namespace: 'staff' | 'patient' = 'staff',
  op: FlightOp = REFRESH_OP,
): Promise<FlightResult> {
  const flights = flightsMap();
  const key = refreshFlightKey(refreshToken, namespace);
  const now = Date.now();
  const existing = flights.get(key);
  if (existing && existing.expiresAt > now) {
    if (op === REFRESH_OP) {
      return settle(existing);
    }
    if (existing.op === op) {
      return existing.promise;
    }
    if (existing.op === REFRESH_OP) {
      if (existing.successor) {
        return existing.successorOp === op
          ? existing.successor
          : { ok: false, status: branchSwitchConfig.conflictStatus };
      }
      // Registered synchronously (before any await) so a refresh arriving next already sees it.
      existing.successorOp = op;
      existing.successor = (async () => {
        const prior = await existing.promise;
        const rotated = flightTokens(prior);
        if (!prior.ok || !rotated) {
          return prior;
        }
        return runRefreshSingleFlight(rotated.refreshToken, () => fn(rotated), namespace, op);
      })();
      return existing.successor;
    }
    return { ok: false, status: branchSwitchConfig.conflictStatus };
  }
  if (existing?.cleanupTimer) {
    clearTimeout(existing.cleanupTimer);
  }

  const entry: FlightEntry = {
    op,
    promise: undefined as unknown as FlightEntry['promise'],
    expiresAt: now + sessionConfig.refreshSingleFlightTtlMs,
  };

  entry.promise = fn().finally(() => {
    const current = flights.get(key);
    if (current?.promise !== entry.promise) {
      return;
    }
    // Keep briefly so near-simultaneous waiters still join; then drop.
    const timer = setTimeout(() => {
      if (flights.get(key)?.promise === entry.promise) {
        flights.delete(key);
      }
    }, sessionConfig.refreshSingleFlightTtlMs);
    // Do not keep the Node process / Jest open for this cleanup timer.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    entry.cleanupTimer = timer;
  });

  flights.set(key, entry);
  return op === REFRESH_OP ? settle(entry) : entry.promise;
}

/** Test-only: clear the map and any pending cleanup timers. */
export function clearRefreshFlightsForTests(): void {
  const flights = flightsMap();
  for (const entry of flights.values()) {
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
    }
  }
  flights.clear();
}
