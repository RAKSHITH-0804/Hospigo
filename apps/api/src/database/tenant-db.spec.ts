import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { runWithContext } from '../common/request-context';
import {
  asHospital,
  createAppPrisma,
  createOwnerPrisma,
  createTenantDb,
  hospitalContext,
  requireTestDatabaseUrl,
} from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('TenantDb', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(60_000);

  const owner = createOwnerPrisma();
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const a = await owner.hospital.create({
      data: {
        code: `TDB_A_${stamp}`,
        name: 'TenantDb A',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `tdba-${stamp}` },
        },
      },
    });
    const b = await owner.hospital.create({
      data: {
        code: `TDB_B_${stamp}`,
        name: 'TenantDb B',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `tdbb-${stamp}` },
        },
      },
    });
    tenantA = a.id;
    tenantB = b.id;
    await owner.auditLog.create({
      data: {
        tenantId: tenantA,
        action: 'PROBE_A',
        entityType: 'test',
        entityId: 'a',
      },
    });
    await owner.auditLog.create({
      data: {
        tenantId: tenantB,
        action: 'PROBE_B',
        entityType: 'test',
        entityId: 'b',
      },
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  it('no tenant in context = refused before touching the database', async () => {
    const app = createAppPrisma();
    const db = createTenantDb(app);
    await expect(db.withTenant(async () => 1)).rejects.toThrow(/Request context is required/);
    await expect(
      runWithContext(
        {
          tenantId: null,
          userId: null,
          kind: 'HOSPITAL',
          activeBranchId: null,
          requestId: 'x',
        },
        () => db.withTenant(async () => 1),
      ),
    ).rejects.toThrow(/no tenant in request context/);
    await app.$disconnect();
  });

  it('HQ context refused', async () => {
    const app = createAppPrisma();
    const db = createTenantDb(app);
    await expect(
      runWithContext(
        {
          tenantId: tenantA,
          userId: null,
          kind: 'HQ',
          activeBranchId: null,
          requestId: 'hq',
        },
        () => db.withTenant(async () => 1),
      ),
    ).rejects.toThrow(/HQ context cannot open a tenant transaction/);
    await app.$disconnect();
  });

  it('connection reuse: pool of one — A then bare query sees zero — then B cannot see A', async () => {
    const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
    const prisma = new (await import('../generated/prisma')).PrismaClient({
      adapter: new PrismaPg(pool),
    });
    const db = createTenantDb(prisma);

    const countA = await asHospital(tenantA, () =>
      db.withTenant((tx) => tx.auditLog.count({ where: { action: 'PROBE_A' } })),
    );
    expect(countA).toBe(1);

    // No tenant setting: fail-closed zero rows on same pooled connection.
    const bare = await prisma.auditLog.count({ where: { action: 'PROBE_A' } });
    expect(bare).toBe(0);

    const leak = await asHospital(tenantB, () =>
      db.withTenant((tx) => tx.auditLog.count({ where: { action: 'PROBE_A' } })),
    );
    expect(leak).toBe(0);
    const countB = await asHospital(tenantB, () =>
      db.withTenant((tx) => tx.auditLog.count({ where: { action: 'PROBE_B' } })),
    );
    expect(countB).toBe(1);

    await prisma.$disconnect();
    await pool.end();
  });

  it('50 parallel withTenant calls across two hospitals never mix data', async () => {
    const app = createAppPrisma();
    const db = createTenantDb(app);
    const jobs = Array.from({ length: 50 }, (_, i) => {
      const tenantId = i % 2 === 0 ? tenantA : tenantB;
      const expectAction = i % 2 === 0 ? 'PROBE_A' : 'PROBE_B';
      const forbidAction = i % 2 === 0 ? 'PROBE_B' : 'PROBE_A';
      return runWithContext(hospitalContext(tenantId), async () => {
        const ok = await db.withTenant((tx) =>
          tx.auditLog.count({ where: { action: expectAction } }),
        );
        const leak = await db.withTenant((tx) =>
          tx.auditLog.count({ where: { action: forbidAction } }),
        );
        return { ok, leak, tenantId };
      });
    });
    const results = await Promise.all(jobs);
    for (const r of results) {
      expect(r.ok).toBe(1);
      expect(r.leak).toBe(0);
    }
    await app.$disconnect();
  });

  it('tenant setting does not survive after the transaction ends', async () => {
    const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
    const { PrismaClient } = await import('../generated/prisma');
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const db = createTenantDb(prisma);

    await asHospital(tenantA, () =>
      db.withTenant(async (tx) => {
        const n = await tx.auditLog.count({ where: { action: 'PROBE_A' } });
        expect(n).toBe(1);
      }),
    );

    const after = await prisma.$queryRaw<Array<{ v: string | null }>>`
      SELECT current_setting('app.tenant_id', true) AS v
    `;
    expect(after[0]?.v === null || after[0]?.v === '').toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'PROBE_A' } })).toBe(0);

    await prisma.$disconnect();
    await pool.end();
  });
});
