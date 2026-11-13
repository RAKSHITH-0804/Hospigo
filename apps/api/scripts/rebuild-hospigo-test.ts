/**
 * Rebuild hospigo_test from migrations (owner role), then idempotent reference seed.
 * Approach: DROP SCHEMA public CASCADE → CREATE SCHEMA → re-apply create-roles schema
 * grants/default privileges → prisma migrate deploy → seedReferenceData.
 * CONNECT hardening is database-level and survives the schema drop.
 * Never prints passwords or connection URLs.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';
import { seedReferenceData } from '../prisma/seeds/reference';
import {
  assertCurrentDatabaseIsHospigoTest,
  assertNoNonTestHospitals,
  assertRebuildUrlPair,
  parsePgUrl,
} from '../src/database/rebuild-guards';

function fsExists(p: string): boolean {
  return fs.existsSync(p);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');

loadEnv({ path: path.join(repoRoot, '.env') });
loadEnv({ path: path.join(apiRoot, '.env') });

function requireUrl(label: string, url: string | undefined): string {
  if (!url) {
    throw new Error(`${label} is required`);
  }
  return url;
}

const appUrl = requireUrl(
  'DATABASE_URL_TEST (or DATABASE_URL)',
  process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
);
const ownerUrl = requireUrl('DATABASE_URL_OWNER_TEST', process.env.DATABASE_URL_OWNER_TEST);

async function reapplySchemaHardening(client: pg.Client): Promise<void> {
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query('GRANT USAGE, CREATE ON SCHEMA public TO hospigo_owner');
  await client.query('GRANT USAGE ON SCHEMA public TO hospigo_app');
  await client.query('GRANT USAGE ON SCHEMA public TO hospigo_hq');
  await client.query('GRANT USAGE ON SCHEMA public TO hospigo_patient');
  await client.query('GRANT USAGE, CREATE ON SCHEMA public TO hospigo_security');
  await client.query('ALTER SCHEMA public OWNER TO hospigo_owner');
}

/**
 * All safety checks that must pass BEFORE DROP SCHEMA.
 */
export async function assertSafeToRebuildHospigoTest(
  appConnectionString: string,
  ownerConnectionString: string,
): Promise<void> {
  assertRebuildUrlPair(appConnectionString, ownerConnectionString);

  const owner = new pg.Client({
    connectionString: ownerConnectionString,
    connectionTimeoutMillis: 15_000,
  });
  await owner.connect();
  try {
    await assertCurrentDatabaseIsHospigoTest(owner, 'owner connection');
    await assertNoNonTestHospitals(owner);
  } finally {
    await owner.end();
  }

  const app = new pg.Client({
    connectionString: appConnectionString,
    connectionTimeoutMillis: 15_000,
  });
  await app.connect();
  try {
    await assertCurrentDatabaseIsHospigoTest(app, 'app connection');
  } finally {
    await app.end();
  }
}

export async function rebuildHospigoTest(): Promise<{
  ownerDb: string;
  appDb: string;
}> {
  await assertSafeToRebuildHospigoTest(appUrl, ownerUrl);

  const owner = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 15_000 });
  await owner.connect();
  try {
    await owner.query('DROP SCHEMA IF EXISTS public CASCADE');
    await owner.query('CREATE SCHEMA public');
    await reapplySchemaHardening(owner);
  } finally {
    await owner.end();
  }

  const prismaCli = path.join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const prismaBin = fsExists(prismaCli)
    ? prismaCli
    : path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const migrate = spawnSync(process.execPath, [prismaBin, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL_OWNER: ownerUrl,
    },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    const err = `${migrate.stderr || ''}\n${migrate.stdout || ''}`.trim();
    throw new Error(`prisma migrate deploy failed (exit ${migrate.status}): ${err.slice(0, 800)}`);
  }

  const adapter = new PrismaPg({ connectionString: ownerUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }

  return {
    ownerDb: parsePgUrl(ownerUrl).database,
    appDb: parsePgUrl(appUrl).database,
  };
}

export async function assertTenantTablesEmpty(): Promise<void> {
  const owner = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 15_000 });
  await owner.connect();
  try {
    const tables = await owner.query<{ name: string }>(`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        )
      ORDER BY 1
    `);
    const leftovers: Array<{ table: string; count: number }> = [];
    for (const row of tables.rows) {
      const count = await owner.query<{ c: string }>(
        `SELECT COUNT(*)::bigint AS c FROM "${row.name}"`,
      );
      const n = Number(count.rows[0]?.c ?? 0);
      if (n > 0) {
        leftovers.push({ table: row.name, count: n });
      }
    }
    if (leftovers.length > 0) {
      throw new Error(
        `hospigo_test has leftover tenant rows at suite start: ${JSON.stringify(leftovers)}`,
      );
    }

    // After reference seed only: no hospitals, users, hq_users, or is_test tenants.
    const zeros = await owner.query<{
      hospitals: string;
      users: string;
      hq_users: string;
      is_test: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::bigint FROM hospitals) AS hospitals,
        (SELECT COUNT(*)::bigint FROM users) AS users,
        (SELECT COUNT(*)::bigint FROM hq_users) AS hq_users,
        (SELECT COUNT(*)::bigint FROM hospitals WHERE is_test = true) AS is_test
    `);
    const row = zeros.rows[0]!;
    const counts = {
      hospitals: Number(row.hospitals),
      users: Number(row.users),
      hq_users: Number(row.hq_users),
      is_test: Number(row.is_test),
    };
    if (
      counts.hospitals !== 0 ||
      counts.users !== 0 ||
      counts.hq_users !== 0 ||
      counts.is_test !== 0
    ) {
      throw new Error(
        `After reference seed only, expected zero hospitals/users/hq_users/is_test; got ${JSON.stringify(counts)}`,
      );
    }
  } finally {
    await owner.end();
  }
}

export type GrantAudit = {
  schema: Record<string, boolean>;
  tableCount: number;
  policyCount: number;
  tables: unknown[];
  policies: unknown[];
};

export async function collectGrantAudit(): Promise<GrantAudit> {
  const owner = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 15_000 });
  await owner.connect();
  try {
    const schema = await owner.query(`
      SELECT
        has_schema_privilege('hospigo_app', 'public', 'USAGE') AS app_usage,
        has_schema_privilege('hospigo_hq', 'public', 'USAGE') AS hq_usage,
        has_schema_privilege('hospigo_security', 'public', 'CREATE') AS security_create,
        has_schema_privilege('hospigo_owner', 'public', 'CREATE') AS owner_create
    `);
    const tables = await owner.query(`
      SELECT c.relname AS table_name,
        has_table_privilege('hospigo_app', c.oid, 'SELECT') AS app_select,
        has_table_privilege('hospigo_app', c.oid, 'INSERT') AS app_insert,
        has_table_privilege('hospigo_app', c.oid, 'UPDATE') AS app_update,
        has_table_privilege('hospigo_app', c.oid, 'DELETE') AS app_delete,
        has_table_privilege('hospigo_hq', c.oid, 'SELECT') AS hq_select,
        has_table_privilege('hospigo_hq', c.oid, 'INSERT') AS hq_insert,
        has_table_privilege('hospigo_hq', c.oid, 'UPDATE') AS hq_update,
        has_table_privilege('hospigo_hq', c.oid, 'DELETE') AS hq_delete
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY 1
    `);
    const policies = await owner.query(`
      SELECT schemaname, tablename, policyname, roles::text, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);
    return {
      schema: schema.rows[0] as Record<string, boolean>,
      tableCount: tables.rowCount ?? 0,
      policyCount: policies.rowCount ?? 0,
      tables: tables.rows,
      policies: policies.rows,
    };
  } finally {
    await owner.end();
  }
}

async function main(): Promise<void> {
  const result = await rebuildHospigoTest();
  await assertTenantTablesEmpty();
  const audit = await collectGrantAudit();
  const sentinel = path.join(apiRoot, '.hospigo-test-rebuilt');
  fs.writeFileSync(
    sentinel,
    JSON.stringify({
      at: new Date().toISOString(),
      tenantTablesEmpty: true,
      tableCount: audit.tableCount,
      policyCount: audit.policyCount,
    }),
  );
  console.log(
    JSON.stringify({
      approach:
        'DROP SCHEMA public CASCADE + CREATE SCHEMA + create-roles schema grants + migrate deploy + reference seed',
      databases: result,
      tenantTablesEmpty: true,
      schemaGrants: audit.schema,
      tableCount: audit.tableCount,
      policyCount: audit.policyCount,
    }),
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
