import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import type { Client } from 'pg';
import {
  createOwnerPrisma,
  createPgClient,
  requireTestDatabaseUrl,
  withTenant,
} from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('users: the application login cannot delete a person (hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);
  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let tenant: string;
  let userId: string;

  beforeAll(async () => {
    const hospital = await owner.hospital.create({
      data: { code: `UDG_${stamp}`, name: 'Users delete grant', isTest: true },
    });
    tenant = hospital.id;
    userId = (
      await owner.user.create({
        data: {
          tenantId: tenant,
          code: `U${stamp}`.slice(0, 40),
          email: `udg_${stamp}@example.test`,
          displayName: 'Person',
          passwordHash: 'x',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await owner.$disconnect();
  });

  async function inTenant<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createPgClient('app');
    await c.connect();
    try {
      return await withTenant(c, tenant, () => fn(c));
    } finally {
      await c.end();
    }
  }

  it('refuses DELETE on users for the app login, and the person stays', async () => {
    await expect(
      inTenant((c) => c.query('DELETE FROM users WHERE id = $1', [userId])),
    ).rejects.toThrow(/permission denied/i);
    expect(await owner.user.count({ where: { id: userId } })).toBe(1);
  });

  it('has no DELETE on hospitals, branches, roles, assignments or branch links either', async () => {
    const tables = [
      'users',
      'hospitals',
      'hospital_settings',
      'hospital_module_subscriptions',
      'branch_modules',
      'branches',
      'roles',
      'role_permissions',
      'role_assignments',
      'role_assignment_branches',
      'user_branches',
    ];
    const rows = await inTenant((c) =>
      c.query(
        `SELECT table_name FROM information_schema.role_table_grants
          WHERE grantee = 'hospigo_app' AND privilege_type = 'DELETE' AND table_name = ANY($1)`,
        [tables],
      ),
    );
    expect(rows.rows).toEqual([]);
  });

  it('deactivating and reactivating a person still works for the app login', async () => {
    await inTenant((c) => c.query('UPDATE users SET is_active = false WHERE id = $1', [userId]));
    expect((await owner.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(false);
    await inTenant((c) => c.query('UPDATE users SET is_active = true WHERE id = $1', [userId]));
    expect((await owner.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(true);
  });
});
