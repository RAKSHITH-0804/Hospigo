import { createHash } from 'node:crypto';
import { sessionConfig } from '@/config/session';

export type RefreshFlightPair = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
};

type FlightEntry = {
  promise: Promise<{ ok: true; data: RefreshFlightPair } | { ok: false; status: number }>;
  expiresAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
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

/**
 * In-process single-flight: concurrent refresh with the same token share one upstream call.
 */
export function runRefreshSingleFlight(
  refreshToken: string,
  fn: () => Promise<{ ok: true; data: RefreshFlightPair } | { ok: false; status: number }>,
  namespace: 'staff' | 'patient' = 'staff',
): Promise<{ ok: true; data: RefreshFlightPair } | { ok: false; status: number }> {
  const flights = flightsMap();
  const key = refreshFlightKey(refreshToken, namespace);
  const now = Date.now();
  const existing = flights.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }
  if (existing?.cleanupTimer) {
    clearTimeout(existing.cleanupTimer);
  }

  const entry: FlightEntry = {
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
  return entry.promise;
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
