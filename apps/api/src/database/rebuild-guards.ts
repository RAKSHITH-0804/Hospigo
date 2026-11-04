/**
 * Pre-DROP SCHEMA safety guards for hospigo_test rebuild.
 * Pure URL checks are sync; connection checks take a minimal query client (no DROP).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type PgUrlParts = {
  host: string;
  port: string;
  database: string;
};

export type QueryClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

export function parsePgUrl(url: string): PgUrlParts {
  const u = new URL(url);
  const database = u.pathname.replace(/^\//, '');
  const host = u.hostname;
  const port = u.port || (u.protocol === 'postgresql:' || u.protocol === 'postgres:' ? '5432' : '');
  return { host, port, database };
}

export function assertLocalHost(host: string, label: string): void {
  const normalized = host.toLowerCase();
  if (!LOCAL_HOSTS.has(normalized)) {
    throw new Error(
      `${label}: host must be localhost, 127.0.0.1, or ::1 (got non-local host; value not printed)`,
    );
  }
}

/**
 * Refuse unless both URLs are local, name hospigo_test, and share host/port/database.
 * Does not connect and never prints URLs or passwords.
 */
export function assertRebuildUrlPair(appUrl: string, ownerUrl: string): void {
  const app = parsePgUrl(appUrl);
  const owner = parsePgUrl(ownerUrl);

  assertLocalHost(app.host, 'app URL');
  assertLocalHost(owner.host, 'owner URL');

  if (app.database !== 'hospigo_test') {
    throw new Error(`app URL must target database hospigo_test (got "${app.database}")`);
  }
  if (owner.database !== 'hospigo_test') {
    throw new Error(`owner URL must target database hospigo_test (got "${owner.database}")`);
  }

  if (app.host !== owner.host || app.port !== owner.port || app.database !== owner.database) {
    throw new Error(
      'app and owner URLs must share the same host, port, and database name (hospigo_test)',
    );
  }
}

export async function assertCurrentDatabaseIsHospigoTest(
  client: QueryClient,
  label: string,
): Promise<void> {
  const result = await client.query<{ current_database: string }>(
    'SELECT current_database() AS current_database',
  );
  const name = result.rows[0]?.current_database;
  if (name !== 'hospigo_test') {
    throw new Error(
      `${label}: connected database must be hospigo_test (got "${name ?? 'unknown'}")`,
    );
  }
}

/**
 * If hospitals exists and any row has is_test = false, refuse (never DROP production-like data).
 */
export async function assertNoNonTestHospitals(client: QueryClient): Promise<void> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'hospitals'
     ) AS exists`,
  );
  if (!exists.rows[0]?.exists) {
    return;
  }
  const bad = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM hospitals WHERE is_test = false`,
  );
  const n = Number(bad.rows[0]?.c ?? 0);
  if (n > 0) {
    throw new Error(`Refusing rebuild: hospitals table contains ${n} row(s) with is_test = false`);
  }
}
