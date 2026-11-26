import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/** The command that brings a database up to date (never run automatically). */
export const MIGRATE_COMMAND = 'npm run prisma:migrate -w @hospigo/api';

export type MigrationsState = {
  /** ok: up to date. behind: migrations of the repo are missing in the database. unknown: could not be checked. */
  status: 'ok' | 'behind' | 'unknown';
  /** Migration folders of the repo that the database has not applied, oldest first. */
  missing: string[];
  /** Applied in the database but not in the repo (an older or other branch): reported, never blocks. */
  extra: string[];
};

/** Compares what the database applied with the migration folders of the repo. */
export function compareMigrations(
  applied: readonly string[],
  onDisk: readonly string[],
): MigrationsState {
  const have = new Set(applied);
  const want = new Set(onDisk);
  const missing = [...onDisk].filter((name) => !have.has(name)).sort();
  const extra = [...applied].filter((name) => !want.has(name)).sort();
  return { status: missing.length > 0 ? 'behind' : 'ok', missing, extra };
}

export const behindMessage = (missing: readonly string[]): string =>
  [
    '',
    '!!! THE DATABASE IS BEHIND THE CODE !!!',
    `Missing migrations (${missing.length}): ${missing.join(', ')}`,
    `Run this, then start again:  ${MIGRATE_COMMAND}`,
    '',
  ].join('\n');

/** The migration folders of the repo (apps/api/prisma/migrations), from source or from dist. */
export function migrationFolders(
  dir = path.resolve(__dirname, '../../prisma/migrations'),
): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Needs the owner login (the application login cannot read the migrations table). */
export async function readAppliedMigrations(ownerUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: ownerUrl, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const result = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    return result.rows.map((row) => row.migration_name);
  } finally {
    await client.end();
  }
}

/** Never throws: when it cannot look (no owner URL, no table) the answer is "unknown". */
export async function checkMigrations(ownerUrl: string | undefined): Promise<MigrationsState> {
  if (!ownerUrl) {
    return { status: 'unknown', missing: [], extra: [] };
  }
  try {
    return compareMigrations(await readAppliedMigrations(ownerUrl), migrationFolders());
  } catch {
    return { status: 'unknown', missing: [], extra: [] };
  }
}

let cached: { at: number; state: MigrationsState } | null = null;

/** For /health/details: checked at most every 30 seconds. */
export async function cachedMigrationsState(): Promise<MigrationsState> {
  if (cached && Date.now() - cached.at < 30_000) {
    return cached.state;
  }
  const state = await checkMigrations(process.env.DATABASE_URL_OWNER);
  cached = { at: Date.now(), state };
  return state;
}
