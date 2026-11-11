import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma, createPgClient, requireTestDatabaseUrl } from './db-test.util';

loadEnv({ path: path.resolve(__dirname, '../../../../.env') });

describe('hospigo_security column privileges (hospigo_test only)', () => {
  requireTestDatabaseUrl();
  const prisma = createOwnerPrisma();
  let hospitalId: string;

  beforeAll(async () => {
    const h = await prisma.hospital.create({
      data: {
        code: `SEC_${Date.now()}`,
        name: 'Security Lock Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `sec-${Date.now()}` },
        },
        roles: { create: { code: 'SUPER_ADMIN', name: 'Super Admin', isSystem: true } },
      },
    });
    hospitalId = h.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('can lock a hospital row FOR UPDATE but cannot change other columns', async () => {
    const owner = createPgClient('owner');
    await owner.connect();
    try {
      await owner.query('BEGIN');
      await owner.query('SET LOCAL ROLE hospigo_security');
      const locked = await owner.query(`SELECT id, name FROM hospitals WHERE id = $1 FOR UPDATE`, [
        hospitalId,
      ]);
      expect(locked.rowCount).toBe(1);

      await owner.query('SAVEPOINT before_name_update');
      await expect(
        owner.query(`UPDATE hospitals SET name = $1 WHERE id = $2`, ['Hacked', hospitalId]),
      ).rejects.toThrow(/permission denied/i);
      await owner.query('ROLLBACK TO SAVEPOINT before_name_update');

      // id-only update (same value) is allowed by column grant
      await owner.query(`UPDATE hospitals SET id = id WHERE id = $1`, [hospitalId]);
      await owner.query('ROLLBACK');
    } finally {
      await owner.end();
    }
  });

  it('hq_create_first_superadmin still succeeds for an active hospital', async () => {
    const hq = createPgClient('hq');
    await hq.connect();
    try {
      const result = await hq.query<{ hq_create_first_superadmin: string }>(
        `SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`,
        [hospitalId, `SA_${Date.now()}`, `sa_${Date.now()}@example.test`, 'SA', 'hash'],
      );
      expect(result.rows[0]?.hq_create_first_superadmin).toBeTruthy();
    } finally {
      await hq.end();
    }
  });
});
