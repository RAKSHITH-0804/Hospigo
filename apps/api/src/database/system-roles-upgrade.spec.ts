import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ensureSystemRolesForTenant, seedReferenceData } from '../../prisma/seeds/reference';
import { createOwnerPrisma, requireTestDatabaseUrl } from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * Upgrade path for hospitals that already exist: the reference seed gives their SYSTEM roles any
 * permission added later, and never touches a custom role.
 */
describe('seed upgrade of system roles (hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);
  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let tenant: string;

  beforeAll(async () => {
    await seedReferenceData(owner);
    tenant = (
      await owner.hospital.create({
        data: { code: `SRU_${stamp}`, name: 'Role upgrade', isTest: true },
      })
    ).id;
  });
  afterAll(async () => {
    await owner.$disconnect();
  });

  const activeCodes = async (roleId: string): Promise<string[]> =>
    (
      await owner.rolePermission.findMany({
        where: { tenantId: tenant, roleId, isActive: true },
        include: { permission: true },
      })
    )
      .map((r) => r.permission.code)
      .sort();

  it('restores a permission a system role is missing, and leaves custom roles exactly as they are', async () => {
    const { superAdminRoleId } = await ensureSystemRolesForTenant(owner, tenant);
    const before = await activeCodes(superAdminRoleId);
    expect(before.length).toBeGreaterThan(10);

    // a custom role with one permission on and one switched off by the hospital
    const perms = await owner.permission.findMany({
      where: { code: { in: ['opd.visits.read', 'opd.billing.read'] } },
    });
    const custom = await owner.role.create({
      data: { tenantId: tenant, code: `CUSTOM_${stamp}`, name: 'Custom' },
    });
    await owner.rolePermission.create({
      data: { tenantId: tenant, roleId: custom.id, permissionId: perms[0]!.id },
    });
    await owner.rolePermission.create({
      data: { tenantId: tenant, roleId: custom.id, permissionId: perms[1]!.id, isActive: false },
    });
    const customBefore = await owner.rolePermission.findMany({
      where: { tenantId: tenant, roleId: custom.id },
      orderBy: { permissionId: 'asc' },
    });

    // simulate "a permission added after this hospital was set up": the system role lacks it
    const missing = await owner.permission.findFirstOrThrow({ where: { code: before[0]! } });
    await owner.rolePermission.deleteMany({
      where: { tenantId: tenant, roleId: superAdminRoleId, permissionId: missing.id },
    });
    expect(await activeCodes(superAdminRoleId)).not.toContain(before[0]);

    await ensureSystemRolesForTenant(owner, tenant);

    expect(await activeCodes(superAdminRoleId)).toEqual(before);
    const customAfter = await owner.rolePermission.findMany({
      where: { tenantId: tenant, roleId: custom.id },
      orderBy: { permissionId: 'asc' },
    });
    expect(customAfter).toEqual(customBefore);
    expect((await owner.role.findUniqueOrThrow({ where: { id: custom.id } })).isActive).toBe(true);
  });
});
