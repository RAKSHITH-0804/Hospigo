import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import {
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  GLOBAL_TABLES,
  requireTestDatabaseUrl,
  withTenant,
} from './db-test.util';

loadEnv({ path: path.resolve(__dirname, '../../../../.env') });

describe('Postgres RLS and security (hospigo_test only)', () => {
  const databaseUrl = requireTestDatabaseUrl();
  const prisma = createOwnerPrisma();
  const appPrisma = createAppPrisma();
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    void databaseUrl;
    void appPrisma;
    const hospitalA = await prisma.hospital.create({
      data: {
        code: `T_A_${Date.now()}`,
        name: 'Tenant A Fixture',
        isTest: true,
        branches: {
          create: {
            code: 'MAIN',
            name: 'Main',
            isMain: true,
            accessCode: `access-a-${Date.now()}`,
          },
        },
      },
      include: { branches: true },
    });
    const hospitalB = await prisma.hospital.create({
      data: {
        code: `T_B_${Date.now()}`,
        name: 'Tenant B Fixture',
        isTest: true,
        branches: {
          create: {
            code: 'MAIN',
            name: 'Main',
            isMain: true,
            accessCode: `access-b-${Date.now()}`,
          },
        },
      },
      include: { branches: true },
    });
    tenantA = hospitalA.id;
    tenantB = hospitalB.id;
    branchA = hospitalA.branches[0]!.id;
    branchB = hospitalB.branches[0]!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('catalog: every non-global table has RLS + FORCE', async () => {
    const client = createPgClient('owner');
    await client.connect();
    try {
      const result = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
      `);

      const offenders = result.rows.filter((row) => {
        if (GLOBAL_TABLES.has(row.relname)) {
          return false;
        }
        return !(row.relrowsecurity && row.relforcerowsecurity);
      });
      expect(offenders).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('hospigo_app has no privileges on _prisma_migrations', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const privs = await client.query<{
        select: boolean;
        insert: boolean;
        update: boolean;
        delete: boolean;
      }>(`
        SELECT
          has_table_privilege('hospigo_app', 'public._prisma_migrations', 'SELECT') AS select,
          has_table_privilege('hospigo_app', 'public._prisma_migrations', 'INSERT') AS insert,
          has_table_privilege('hospigo_app', 'public._prisma_migrations', 'UPDATE') AS update,
          has_table_privilege('hospigo_app', 'public._prisma_migrations', 'DELETE') AS delete
      `);
      expect(privs.rows[0]).toEqual({
        select: false,
        insert: false,
        update: false,
        delete: false,
      });
      await expect(client.query('SELECT 1 FROM _prisma_migrations LIMIT 1')).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('no tenant set returns zero hospital rows for app role', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const rows = await withTenant(client, null, async () => {
        const r = await client.query('SELECT id FROM hospitals');
        return r.rows;
      });
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('tenant A cannot read tenant B rows', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const rows = await withTenant(client, tenantA, async () => {
        const r = await client.query('SELECT id FROM hospitals WHERE id = $1', [tenantB]);
        return r.rows;
      });
      expect(rows).toHaveLength(0);

      const branchRows = await withTenant(client, tenantA, async () => {
        const r = await client.query('SELECT id FROM branches WHERE id = $1', [branchB]);
        return r.rows;
      });
      expect(branchRows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('tenant A can read own rows', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const rows = await withTenant(client, tenantA, async () => {
        const r = await client.query('SELECT id FROM hospitals WHERE id = $1', [tenantA]);
        return r.rows;
      });
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('audit_logs refuse update, delete, and truncate', async () => {
    const owner = createPgClient('owner');
    await owner.connect();
    try {
      const inserted = await owner.query<{ id: string }>(
        `INSERT INTO audit_logs (id, tenant_id, action, entity_type, created_at)
         VALUES (replace(gen_random_uuid()::text, '-', ''), $1, 'TEST', 'x', NOW())
         RETURNING id`,
        [tenantA],
      );
      const id = inserted.rows[0]!.id;
      await expect(
        owner.query('UPDATE audit_logs SET action = $1 WHERE id = $2', ['X', id]),
      ).rejects.toThrow(/append-only/i);
      await expect(owner.query('DELETE FROM audit_logs WHERE id = $1', [id])).rejects.toThrow(
        /append-only/i,
      );
      await expect(owner.query('TRUNCATE audit_logs')).rejects.toThrow(/append-only|truncate/i);
    } finally {
      await owner.end();
    }
  });

  it('hospigo_app is not superuser and cannot create tables', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(role.rows[0]?.rolsuper).toBe(false);
      expect(role.rows[0]?.rolbypassrls).toBe(false);
      await expect(client.query('CREATE TABLE app_should_fail (id int)')).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('composite keys block cross-hospital user_branches', async () => {
    const user = await prisma.user.create({
      data: {
        tenantId: tenantA,
        code: `U_${Date.now()}`,
        email: `u_${Date.now()}@example.test`,
        displayName: 'Cross FK User',
        passwordHash: 'x',
      },
    });
    await expect(
      prisma.userBranch.create({
        data: {
          tenantId: tenantA,
          userId: user.id,
          branchId: branchB,
        },
      }),
    ).rejects.toThrow();
  });

  it('branch_modules require hospital subscription and only one main branch', async () => {
    const module = await prisma.module.create({
      data: { code: `M_${Date.now()}`, name: 'Temp Module' },
    });
    await expect(
      prisma.branchModule.create({
        data: {
          tenantId: tenantA,
          branchId: branchA,
          moduleId: module.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.branch.create({
        data: {
          tenantId: tenantA,
          code: `MAIN2_${Date.now()}`,
          name: 'Second Main',
          isMain: true,
          accessCode: `second-main-${Date.now()}`,
        },
      }),
    ).rejects.toThrow();
  });

  it('lookup_branch_by_access_code returns active hits and identical empties otherwise', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchA } });
      type Row = { branch_id: string; tenant_id: string; is_main: boolean };
      const ok = await client.query<Row>(
        `SELECT branch_id, tenant_id, is_main FROM lookup_branch_by_access_code($1)`,
        [branch.accessCode],
      );
      expect(ok.rows).toEqual([{ branch_id: branchA, tenant_id: tenantA, is_main: true }]);

      const missing = await client.query<Row>(
        `SELECT branch_id, tenant_id, is_main FROM lookup_branch_by_access_code($1)`,
        ['definitely-unknown-code'],
      );
      expect(missing.rows).toEqual([]);

      await prisma.branch.update({
        where: { id: branchA },
        data: { isActive: false },
      });
      const inactiveBranch = await client.query<Row>(
        `SELECT branch_id, tenant_id, is_main FROM lookup_branch_by_access_code($1)`,
        [branch.accessCode],
      );
      expect(inactiveBranch.rows).toEqual([]);
      await prisma.branch.update({
        where: { id: branchA },
        data: { isActive: true },
      });

      await prisma.hospital.update({
        where: { id: tenantA },
        data: { status: 'INACTIVE' },
      });
      const inactiveHospital = await client.query<Row>(
        `SELECT branch_id, tenant_id, is_main FROM lookup_branch_by_access_code($1)`,
        [branch.accessCode],
      );
      expect(inactiveHospital.rows).toEqual([]);
      await prisma.hospital.update({
        where: { id: tenantA },
        data: { status: 'ACTIVE' },
      });
    } finally {
      await client.end();
    }
  });

  it('SECURITY DEFINER functions revoke PUBLIC execute and fix search_path', async () => {
    const client = createPgClient('owner');
    await client.connect();
    try {
      const funcs = await client.query<{
        oid: string;
        proname: string;
        args: string;
        prosecdef: boolean;
        proconfig: string[] | null;
        public_exec: boolean;
      }>(`
        SELECT p.oid::text AS oid,
               p.proname,
               pg_get_function_identity_arguments(p.oid) AS args,
               p.prosecdef,
               p.proconfig,
               has_function_privilege(0::oid, p.oid, 'EXECUTE') AS public_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef = true
        ORDER BY p.proname
      `);

      expect(funcs.rows.length).toBeGreaterThan(0);
      for (const fn of funcs.rows) {
        expect(fn.public_exec).toBe(false);
        expect((fn.proconfig || []).join(',')).toMatch(/search_path=pg_catalog,\s*public/);
      }
    } finally {
      await client.end();
    }
  });

  it('cross-role execute is denied for SECURITY DEFINER helpers', async () => {
    const hq = createPgClient('hq');
    const app = createPgClient('app');
    await hq.connect();
    await app.connect();
    try {
      await expect(hq.query(`SELECT lookup_branch_by_access_code('x')`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        app.query(`SELECT hq_create_first_superadmin($1, 'u', 'a@b.c', 'n', 'hash')`, [tenantA]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await hq.end();
      await app.end();
    }
  });

  it('hospigo_hq cannot read users (outside allowed tables)', async () => {
    const client = createPgClient('hq');
    await client.connect();
    try {
      await expect(client.query('SELECT id FROM users LIMIT 1')).rejects.toThrow();
      const hospitals = await client.query('SELECT id FROM hospitals WHERE id = $1', [tenantA]);
      expect(hospitals.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});
