/**
 * Reference catalog seed must not introduce hospitals, users, hq_users, or isTest tenants.
 * Full zero-state after rebuild is also asserted in scripts/rebuild-hospigo-test.ts
 * (`assertTenantTablesEmpty` runs after reference seed in Jest globalSetup).
 */
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { seedReferenceData } from '../../prisma/seeds/reference';
import { createOwnerPrisma } from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('reference seed only (no demo tenants)', () => {
  const owner = createOwnerPrisma();

  afterAll(async () => {
    await owner.$disconnect();
  });

  it('does not create hospitals, users, hq_users, or isTest hospitals', async () => {
    const before = {
      hospitals: await owner.hospital.count(),
      users: await owner.user.count(),
      hqUsers: await owner.hqUser.count(),
      isTest: await owner.hospital.count({ where: { isTest: true } }),
    };

    await seedReferenceData(owner);

    const after = {
      hospitals: await owner.hospital.count(),
      users: await owner.user.count(),
      hqUsers: await owner.hqUser.count(),
      isTest: await owner.hospital.count({ where: { isTest: true } }),
    };

    expect(after.hospitals).toBe(before.hospitals);
    expect(after.users).toBe(before.users);
    expect(after.hqUsers).toBe(before.hqUsers);
    expect(after.isTest).toBe(before.isTest);

    expect(await owner.module.count({ where: { isActive: true } })).toBeGreaterThan(0);
    expect(await owner.permission.count({ where: { isActive: true } })).toBeGreaterThan(0);
  });
});
