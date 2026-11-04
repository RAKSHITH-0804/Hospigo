import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { runWithContext, type RequestContext } from '../common/request-context';
import { PrismaClient } from '../generated/prisma';
import { TenantDb } from './tenant-db';
import { PrismaService } from './prisma.service';

export const GLOBAL_TABLES = new Set([
  'modules',
  'permissions',
  'hq_users',
  // Prisma's own table, holds no tenant data.
  '_prisma_migrations',
  // Global system field catalog (exact name).
  'patient_field_catalog',
  // Global import type catalog (exact name).
  'import_types',
]);

export function requireTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL_TEST (or DATABASE_URL) is required for DB tests');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (dbName !== 'hospigo_test') {
    throw new Error(
      `Refusing to run DB tests against database "${dbName}". Expected hospigo_test.`,
    );
  }
  return url;
}

export function createAppPrisma(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: requireTestDatabaseUrl() });
  return new PrismaClient({ adapter });
}

/** Owner connection (BYPASSRLS) for test fixtures only. */
export function createOwnerPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL_OWNER_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER_TEST is required for DB fixtures');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (dbName !== 'hospigo_test') {
    throw new Error(`Refusing fixtures against database "${dbName}"`);
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export function createPgClient(role: 'app' | 'owner' | 'hq' = 'app'): Client {
  const envKey =
    role === 'owner'
      ? 'DATABASE_URL_OWNER_TEST'
      : role === 'hq'
        ? 'DATABASE_URL_HQ'
        : 'DATABASE_URL_TEST';
  const url = process.env[envKey] || (role === 'app' ? process.env.DATABASE_URL : undefined);
  if (!url) {
    throw new Error(`${envKey} is required for DB role tests`);
  }
  if (role !== 'hq') {
    const dbName = new URL(url).pathname.replace(/^\//, '');
    if (dbName !== 'hospigo_test') {
      throw new Error(`Refusing non-test database for ${envKey}`);
    }
  } else {
    // HQ URL may point at hospigo; for tests rewrite to hospigo_test without printing.
    const parsed = new URL(url);
    parsed.pathname = '/hospigo_test';
    return new Client({ connectionString: parsed.toString(), connectionTimeoutMillis: 5000 });
  }
  return new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
}

export async function withTenant<T>(
  client: Client,
  tenantId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (tenantId === null || tenantId === '') {
      await client.query(`SELECT set_config('app.tenant_id', '', true)`);
    } else {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export function createTenantDb(prisma: PrismaClient): TenantDb {
  return new TenantDb(prisma as unknown as PrismaService);
}

export function hospitalContext(
  tenantId: string,
  opts?: {
    userId?: string | null;
    activeBranchId?: string | null;
    requestId?: string;
  },
): RequestContext {
  return {
    tenantId,
    userId: opts?.userId ?? null,
    kind: 'HOSPITAL',
    activeBranchId: opts?.activeBranchId ?? null,
    requestId: opts?.requestId ?? `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

export function asHospital<T>(
  tenantId: string,
  fn: () => T,
  opts?: { userId?: string | null; activeBranchId?: string | null },
): T {
  return runWithContext(hospitalContext(tenantId, opts), fn);
}

function extractTenantId(args: unknown[]): string | null {
  for (const arg of args) {
    if (typeof arg === 'string' && arg.length > 0) {
      // First-string arg pattern used by validateForRegistration(tenantId, …).
      return arg;
    }
    if (arg && typeof arg === 'object' && 'tenantId' in arg) {
      const id = (arg as { tenantId?: unknown }).tenantId;
      if (typeof id === 'string' && id.length > 0) {
        return id;
      }
    }
  }
  return null;
}

function extractUserId(args: unknown[]): string | null {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const o = arg as Record<string, unknown>;
    for (const key of ['createdBy', 'actorUserId', 'changedBy', 'userId']) {
      if (typeof o[key] === 'string') return o[key] as string;
    }
  }
  return null;
}

/**
 * Test helper: wraps a service so each public method runs inside a HOSPITAL
 * request context derived from the call's tenantId (keeps existing test call sites).
 */
export function autoHospitalContext<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop === 'symbol') {
        return value;
      }
      return (...args: unknown[]) => {
        const tenantId = extractTenantId(args);
        if (!tenantId) {
          return value.apply(target, args);
        }
        return runWithContext(hospitalContext(tenantId, { userId: extractUserId(args) }), () =>
          value.apply(target, args),
        );
      };
    },
  });
}

/** Startup check: tenant tables must be empty after globalSetup rebuild. */
export async function assertTenantTablesEmpty(): Promise<void> {
  const url = process.env.DATABASE_URL_OWNER_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER_TEST is required');
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const tables = await client.query<{ name: string }>(`
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
      const count = await client.query<{ c: string }>(
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
  } finally {
    await client.end();
  }
}

export async function collectGrantAudit(): Promise<{
  schema: Record<string, boolean>;
  tableCount: number;
  policyCount: number;
  tables: Array<Record<string, unknown>>;
}> {
  const url = process.env.DATABASE_URL_OWNER_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER_TEST is required');
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const schema = await client.query(`
      SELECT
        has_schema_privilege('hospigo_app', 'public', 'USAGE') AS app_usage,
        has_schema_privilege('hospigo_hq', 'public', 'USAGE') AS hq_usage,
        has_schema_privilege('hospigo_security', 'public', 'CREATE') AS security_create,
        has_schema_privilege('hospigo_owner', 'public', 'CREATE') AS owner_create
    `);
    const tables = await client.query(`
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
    const policies = await client.query(`
      SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    `);
    return {
      schema: schema.rows[0] as Record<string, boolean>,
      tableCount: tables.rowCount ?? 0,
      policyCount: policies.rowCount ?? 0,
      tables: tables.rows as Array<Record<string, unknown>>,
    };
  } finally {
    await client.end();
  }
}
