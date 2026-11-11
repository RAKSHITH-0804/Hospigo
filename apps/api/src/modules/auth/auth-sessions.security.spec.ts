import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma, createPgClient, withTenant } from '../../database/db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('auth_sessions RLS and HQ session grants', () => {
  const prisma = createOwnerPrisma();
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchB: string;
  let userA: string;
  let userB: string;
  let sessionA: string;
  let sessionB: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const a = await prisma.hospital.create({
      data: {
        code: `AS_A_${stamp}`,
        name: 'Auth Sess A',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `as-a-${stamp}` },
        },
      },
      include: { branches: true },
    });
    const b = await prisma.hospital.create({
      data: {
        code: `AS_B_${stamp}`,
        name: 'Auth Sess B',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `as-b-${stamp}` },
        },
      },
      include: { branches: true },
    });
    tenantA = a.id;
    tenantB = b.id;
    branchA = a.branches[0]!.id;
    branchB = b.branches[0]!.id;

    const ua = await prisma.user.create({
      data: {
        tenantId: tenantA,
        code: 'U1',
        email: `asa_${stamp}@example.test`,
        displayName: 'A',
        passwordHash: 'x',
      },
    });
    const ub = await prisma.user.create({
      data: {
        tenantId: tenantB,
        code: 'U1',
        email: `asb_${stamp}@example.test`,
        displayName: 'B',
        passwordHash: 'x',
      },
    });
    userA = ua.id;
    userB = ub.id;

    const sa = await prisma.authSession.create({
      data: {
        tenantId: tenantA,
        userId: userA,
        branchId: branchA,
        tokenHash: `hash-a-${stamp}`,
        familyId: `fam-a-${stamp}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const sb = await prisma.authSession.create({
      data: {
        tenantId: tenantB,
        userId: userB,
        branchId: branchB,
        tokenHash: `hash-b-${stamp}`,
        familyId: `fam-b-${stamp}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    sessionA = sa.id;
    sessionB = sb.id;

    const hqUser = await prisma.hqUser.create({
      data: {
        email: `hq_${stamp}@example.test`,
        displayName: 'HQ',
        passwordHash: 'x',
      },
    });
    await prisma.hqAuthSession.create({
      data: {
        userId: hqUser.id,
        tokenHash: `hq-hash-${stamp}`,
        familyId: `hq-fam-${stamp}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('tenant cannot read another tenant auth_sessions', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const asA = await withTenant(client, tenantA, async () => {
        const r = await client.query(`SELECT id FROM auth_sessions WHERE id = $1`, [sessionB]);
        return r.rowCount ?? 0;
      });
      expect(asA).toBe(0);

      const own = await withTenant(client, tenantA, async () => {
        const r = await client.query(`SELECT id FROM auth_sessions WHERE id = $1`, [sessionA]);
        return r.rowCount ?? 0;
      });
      expect(own).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('hospigo_app cannot touch hq_auth_sessions; hospigo_hq grants stay minimal', async () => {
    const app = createPgClient('app');
    const hq = createPgClient('hq');
    const owner = createPgClient('owner');
    await app.connect();
    await hq.connect();
    await owner.connect();
    try {
      await expect(app.query(`SELECT id FROM hq_auth_sessions LIMIT 1`)).rejects.toThrow(
        /permission denied/i,
      );

      const grants = await owner.query<{
        hq_users_select: boolean;
        hq_users_delete: boolean;
        hq_sess_select: boolean;
        hq_sess_delete: boolean;
        hospitals_select: boolean;
      }>(`
        SELECT
          has_table_privilege('hospigo_hq', 'hq_users', 'SELECT') AS hq_users_select,
          has_table_privilege('hospigo_hq', 'hq_users', 'DELETE') AS hq_users_delete,
          has_table_privilege('hospigo_hq', 'hq_auth_sessions', 'SELECT') AS hq_sess_select,
          has_table_privilege('hospigo_hq', 'hq_auth_sessions', 'DELETE') AS hq_sess_delete,
          has_table_privilege('hospigo_hq', 'hospitals', 'SELECT') AS hospitals_select
      `);
      expect(grants.rows[0]).toEqual({
        hq_users_select: true,
        hq_users_delete: false,
        hq_sess_select: true,
        hq_sess_delete: true,
        hospitals_select: true,
      });

      const hqRead = await hq.query(`SELECT id FROM hq_auth_sessions LIMIT 1`);
      expect((hqRead.rowCount ?? 0) >= 0).toBe(true);
    } finally {
      await app.end();
      await hq.end();
      await owner.end();
    }
  });
});
