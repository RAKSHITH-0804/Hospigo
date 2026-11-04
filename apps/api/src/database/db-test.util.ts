import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { PrismaClient } from '../generated/prisma';

export const GLOBAL_TABLES = new Set([
  'modules',
  'permissions',
  'hq_users',
  // Prisma's own table, holds no tenant data.
  '_prisma_migrations',
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
