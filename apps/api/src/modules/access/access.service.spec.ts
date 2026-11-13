import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { runWithContext } from '../../common/request-context';
import {
  createAppPrisma,
  createOwnerPrisma,
  createTenantDb,
  hospitalContext,
  requireTestDatabaseUrl,
} from '../../database/db-test.util';
import { AccessService } from './access.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('AccessService', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(60_000);

  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  let tenantId: string;
  let mainId: string;
  let eastId: string;
  let archivedId: string;
  let superAdminId: string;
  let branchAdminMainId: string;
  let branchAdminEastId: string;
  let multiStaffId: string;
  let disabledUserId: string;
  let permRead: string;
  let permWrite: string;
  let moduleOpd: string;
  let moduleLab: string;
  let access: AccessService;
  let assignmentEastWriteId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const hospital = await owner.hospital.create({
      data: {
        code: `ACS_${stamp}`,
        name: 'Access Hospital',
        isTest: true,
        status: 'ACTIVE',
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `acs-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `acs-${stamp}-east` },
            {
              code: 'OLD',
              name: 'Archived',
              isMain: false,
              isActive: false,
              accessCode: `acs-${stamp}-old`,
            },
          ],
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;
    mainId = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    eastId = hospital.branches.find((b) => b.code === 'EAST')!.id;
    archivedId = hospital.branches.find((b) => b.code === 'OLD')!.id;

    const pRead = await owner.permission.create({
      data: { code: `acs.read.${stamp}`, description: 'read' },
    });
    const pWrite = await owner.permission.create({
      data: { code: `acs.write.${stamp}`, description: 'write' },
    });
    permRead = pRead.code;
    permWrite = pWrite.code;

    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: {},
    });
    const lab = await owner.module.upsert({
      where: { code: 'LAB' },
      create: { code: 'LAB', name: 'Laboratory' },
      update: {},
    });
    moduleOpd = opd.code;
    moduleLab = lab.code;

    await owner.hospitalModuleSubscription.create({
      data: { tenantId, moduleId: opd.id },
    });
    await owner.hospitalModuleSubscription.create({
      data: { tenantId, moduleId: lab.id },
    });
    await owner.branchModule.create({
      data: {
        tenantId,
        branchId: mainId,
        moduleId: opd.id,
        enabledByIndigo: true,
        restrictedByHospital: false,
      },
    });
    await owner.branchModule.create({
      data: {
        tenantId,
        branchId: eastId,
        moduleId: opd.id,
        enabledByIndigo: true,
        restrictedByHospital: false,
      },
    });
    // LAB enabled only on MAIN; EAST has no LAB module row.
    await owner.branchModule.create({
      data: {
        tenantId,
        branchId: mainId,
        moduleId: lab.id,
        enabledByIndigo: true,
        restrictedByHospital: false,
      },
    });

    const roleHospital = await owner.role.create({
      data: {
        tenantId,
        code: `SUPER_${stamp}`,
        name: 'SuperAdmin',
        isSystem: true,
        permissions: {
          create: [{ permissionId: pRead.id }, { permissionId: pWrite.id }],
        },
      },
    });
    const roleBranchRead = await owner.role.create({
      data: {
        tenantId,
        code: `BR_READ_${stamp}`,
        name: 'Branch Read',
        permissions: { create: [{ permissionId: pRead.id }] },
      },
    });
    const roleBranchWrite = await owner.role.create({
      data: {
        tenantId,
        code: `BR_WRITE_${stamp}`,
        name: 'Branch Write',
        permissions: { create: [{ permissionId: pWrite.id }] },
      },
    });

    const mkUser = async (code: string, active = true) =>
      owner.user.create({
        data: {
          tenantId,
          code,
          email: `${code}@example.test`,
          displayName: code,
          passwordHash: 'x',
          isActive: active,
        },
      });

    const superAdmin = await mkUser(`SA_${stamp}`);
    const baMain = await mkUser(`BAM_${stamp}`);
    const baEast = await mkUser(`BAE_${stamp}`);
    const multi = await mkUser(`MULTI_${stamp}`);
    const disabled = await mkUser(`DIS_${stamp}`, false);
    superAdminId = superAdmin.id;
    branchAdminMainId = baMain.id;
    branchAdminEastId = baEast.id;
    multiStaffId = multi.id;
    disabledUserId = disabled.id;

    for (const [uid, bid] of [
      [superAdminId, mainId],
      [superAdminId, eastId],
      [branchAdminMainId, mainId],
      [branchAdminEastId, eastId],
      [multiStaffId, mainId],
      [multiStaffId, eastId],
      [disabledUserId, mainId],
    ] as const) {
      await owner.userBranch.create({
        data: { tenantId, userId: uid, branchId: bid },
      });
    }

    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: superAdminId,
        roleId: roleHospital.id,
        scopeType: 'HOSPITAL',
      },
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: branchAdminMainId,
        roleId: roleBranchWrite.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: mainId }] },
      },
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: branchAdminEastId,
        roleId: roleBranchWrite.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: eastId }] },
      },
    });
    // Multi-staff: READ on MAIN, WRITE on EAST (never the union).
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: multiStaffId,
        roleId: roleBranchRead.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: mainId }] },
      },
    });
    const eastWrite = await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: multiStaffId,
        roleId: roleBranchWrite.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: eastId }] },
      },
    });
    assignmentEastWriteId = eastWrite.id;

    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: disabledUserId,
        roleId: roleHospital.id,
        scopeType: 'HOSPITAL',
      },
    });

    access = new AccessService(createTenantDb(app));
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  async function asUser<T>(
    userId: string,
    fn: () => Promise<T>,
    activeBranchId: string | null = null,
  ): Promise<T> {
    return runWithContext(hospitalContext(tenantId, { userId, activeBranchId }), fn);
  }

  it('default deny when no matching assignment', async () => {
    const stranger = await owner.user.create({
      data: {
        tenantId,
        code: `STR_${Date.now()}`,
        email: `str_${Date.now()}@example.test`,
        displayName: 'Stranger',
        passwordHash: 'x',
      },
    });
    await expect(asUser(stranger.id, () => access.can(permRead, mainId))).resolves.toBe(false);
  });

  it('Branch Admin of branch 1 is denied for branch 2', async () => {
    await expect(asUser(branchAdminMainId, () => access.can(permWrite, eastId))).resolves.toBe(
      false,
    );
    await expect(asUser(branchAdminMainId, () => access.can(permWrite, mainId))).resolves.toBe(
      true,
    );
  });

  it('SuperAdmin gets all active branches', async () => {
    await expect(asUser(superAdminId, () => access.can(permRead, mainId))).resolves.toBe(true);
    await expect(asUser(superAdminId, () => access.can(permWrite, eastId))).resolves.toBe(true);
    const branches = await asUser(superAdminId, () => access.branchesFor(permRead));
    expect(branches.sort()).toEqual([eastId, mainId].sort());
    expect(branches).not.toContain(archivedId);
  });

  it('activeBranchId only narrows, never widens', async () => {
    await expect(asUser(superAdminId, () => access.can(permRead, eastId), mainId)).resolves.toBe(
      false,
    );
    await expect(asUser(superAdminId, () => access.can(permRead, mainId), mainId)).resolves.toBe(
      true,
    );
  });

  it('multi-branch staff get exactly each branch own permissions (not the union)', async () => {
    await expect(asUser(multiStaffId, () => access.can(permRead, mainId))).resolves.toBe(true);
    await expect(asUser(multiStaffId, () => access.can(permWrite, mainId))).resolves.toBe(false);
    await expect(asUser(multiStaffId, () => access.can(permWrite, eastId))).resolves.toBe(true);
    await expect(asUser(multiStaffId, () => access.can(permRead, eastId))).resolves.toBe(false);
  });

  it('disabled user, archived branch, and inactive hospital are denied', async () => {
    await expect(asUser(disabledUserId, () => access.can(permRead, mainId))).resolves.toBe(false);
    await expect(asUser(superAdminId, () => access.can(permRead, archivedId))).resolves.toBe(false);

    await owner.hospital.update({
      where: { id: tenantId },
      data: { status: 'INACTIVE' },
    });
    await expect(asUser(superAdminId, () => access.can(permRead, mainId))).resolves.toBe(false);
    await owner.hospital.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
    });
  });

  it('branch without the module is denied even for SuperAdmin', async () => {
    await expect(asUser(superAdminId, () => access.can(permRead, eastId, moduleLab))).resolves.toBe(
      false,
    );
    await expect(asUser(superAdminId, () => access.can(permRead, mainId, moduleLab))).resolves.toBe(
      true,
    );
  });

  it('hospital restriction of a module denies', async () => {
    await owner.branchModule.updateMany({
      where: { tenantId, branchId: mainId, module: { code: moduleOpd } },
      data: { restrictedByHospital: true },
    });
    await expect(asUser(superAdminId, () => access.can(permRead, mainId, moduleOpd))).resolves.toBe(
      false,
    );
    await owner.branchModule.updateMany({
      where: { tenantId, branchId: mainId, module: { code: moduleOpd } },
      data: { restrictedByHospital: false },
    });
  });

  it('removing an assignment denies on the next request', async () => {
    await expect(asUser(multiStaffId, () => access.can(permWrite, eastId))).resolves.toBe(true);
    await owner.roleAssignment.update({
      where: { id: assignmentEastWriteId },
      data: { isActive: false },
    });
    // New request context → fresh memo
    await expect(asUser(multiStaffId, () => access.can(permWrite, eastId))).resolves.toBe(false);
  });

  it('BRANCH assignment without user_branches membership denies', async () => {
    const stamp = Date.now();
    const user = await owner.user.create({
      data: {
        tenantId,
        code: `NOM_${stamp}`,
        email: `nom_${stamp}@example.test`,
        displayName: 'No membership',
        passwordHash: 'x',
      },
    });
    const writeRole = await owner.role.findFirstOrThrow({
      where: { tenantId, code: { startsWith: 'BR_WRITE_' } },
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: writeRole.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: mainId }] },
      },
    });
    // No user_branches row for mainId
    await expect(asUser(user.id, () => access.can(permWrite, mainId))).resolves.toBe(false);
  });

  it('user_branches membership without a role assignment denies', async () => {
    const stamp = Date.now();
    const user = await owner.user.create({
      data: {
        tenantId,
        code: `NOA_${stamp}`,
        email: `noa_${stamp}@example.test`,
        displayName: 'No assignment',
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({
      data: { tenantId, userId: user.id, branchId: mainId },
    });
    await expect(asUser(user.id, () => access.can(permWrite, mainId))).resolves.toBe(false);
  });

  it('BRANCH assignment plus active membership allows', async () => {
    const stamp = Date.now();
    const user = await owner.user.create({
      data: {
        tenantId,
        code: `BOTH_${stamp}`,
        email: `both_${stamp}@example.test`,
        displayName: 'Both',
        passwordHash: 'x',
      },
    });
    const writeRole = await owner.role.findFirstOrThrow({
      where: { tenantId, code: { startsWith: 'BR_WRITE_' } },
    });
    await owner.userBranch.create({
      data: { tenantId, userId: user.id, branchId: mainId },
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: writeRole.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: mainId }] },
      },
    });
    await expect(asUser(user.id, () => access.can(permWrite, mainId))).resolves.toBe(true);
  });

  it('deactivated user_branches membership denies BRANCH access', async () => {
    const stamp = Date.now();
    const user = await owner.user.create({
      data: {
        tenantId,
        code: `DEACT_${stamp}`,
        email: `deact_${stamp}@example.test`,
        displayName: 'Deact mem',
        passwordHash: 'x',
      },
    });
    const writeRole = await owner.role.findFirstOrThrow({
      where: { tenantId, code: { startsWith: 'BR_WRITE_' } },
    });
    const membership = await owner.userBranch.create({
      data: { tenantId, userId: user.id, branchId: eastId, isActive: true },
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: writeRole.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: eastId }] },
      },
    });
    await expect(asUser(user.id, () => access.can(permWrite, eastId))).resolves.toBe(true);
    await owner.userBranch.update({
      where: { id: membership.id },
      data: { isActive: false },
    });
    // New request → fresh memo
    await expect(asUser(user.id, () => access.can(permWrite, eastId))).resolves.toBe(false);
  });

  async function fixtureBranchGrant(suffix: string): Promise<{
    userId: string;
    permissionCode: string;
    permissionId: string;
    roleId: string;
    rolePermissionId: string;
    assignmentBranchId: string;
  }> {
    const perm = await owner.permission.create({
      data: { code: `acs.fx.${suffix}`, description: suffix },
    });
    const role = await owner.role.create({
      data: {
        tenantId,
        code: `FX_R_${suffix}`,
        name: `Fixture ${suffix}`,
        permissions: { create: [{ permissionId: perm.id }] },
      },
      include: { permissions: true },
    });
    const user = await owner.user.create({
      data: {
        tenantId,
        code: `FX_U_${suffix}`,
        email: `fx_u_${suffix}@example.test`,
        displayName: suffix,
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({
      data: { tenantId, userId: user.id, branchId: mainId },
    });
    const assignment = await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: role.id,
        scopeType: 'BRANCH',
        branches: { create: [{ branchId: mainId }] },
      },
      include: { branches: true },
    });
    return {
      userId: user.id,
      permissionCode: perm.code,
      permissionId: perm.id,
      roleId: role.id,
      rolePermissionId: role.permissions[0]!.id,
      assignmentBranchId: assignment.branches[0]!.id,
    };
  }

  it('inactive permission denies after an allowed baseline', async () => {
    const fx = await fixtureBranchGrant(`perm_${Date.now()}`);
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      true,
    );
    await owner.permission.update({ where: { id: fx.permissionId }, data: { isActive: false } });
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      false,
    );
  });

  it('inactive role denies after an allowed baseline', async () => {
    const fx = await fixtureBranchGrant(`role_${Date.now()}`);
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      true,
    );
    await owner.role.update({ where: { id: fx.roleId }, data: { isActive: false } });
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      false,
    );
  });

  it('inactive role_permissions row denies after an allowed baseline', async () => {
    const fx = await fixtureBranchGrant(`rp_${Date.now()}`);
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      true,
    );
    await owner.rolePermission.update({
      where: { id: fx.rolePermissionId },
      data: { isActive: false },
    });
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      false,
    );
  });

  it('inactive assignment-branch denies after an allowed baseline', async () => {
    const fx = await fixtureBranchGrant(`ab_${Date.now()}`);
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      true,
    );
    await owner.roleAssignmentBranch.update({
      where: { id: fx.assignmentBranchId },
      data: { isActive: false },
    });
    await expect(asUser(fx.userId, () => access.can(fx.permissionCode, mainId))).resolves.toBe(
      false,
    );
  });

  it('deactivated branch_modules row denies after an allowed baseline', async () => {
    await expect(asUser(superAdminId, () => access.can(permRead, mainId, moduleLab))).resolves.toBe(
      true,
    );
    await owner.branchModule.updateMany({
      where: { tenantId, branchId: mainId, module: { code: moduleLab } },
      data: { isActive: false },
    });
    await expect(asUser(superAdminId, () => access.can(permRead, mainId, moduleLab))).resolves.toBe(
      false,
    );
  });
});
