import argon2 from 'argon2';
import type { PrismaClient } from '../../src/generated/prisma';
import { ensureSystemRolesForTenant } from './reference';

/**
 * Dev-only fake tenants. Seed data lives here (not in app runtime code).
 * Refuses unless NODE_ENV=development. Passwords come from env.
 */
export async function seedDevTenants(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Dev tenant seed refuses to run unless NODE_ENV=development');
  }

  const superPassword = requiredEnv('SEED_SUPERADMIN_PASSWORD');
  const branchPassword = requiredEnv('SEED_BRANCH_ADMIN_PASSWORD');
  const staffPassword = requiredEnv('SEED_STAFF_PASSWORD');

  const modules = await prisma.module.findMany({ where: { isActive: true } });
  if (modules.length === 0) {
    throw new Error('Modules catalog is empty; run reference seed first');
  }

  const hospitals = [
    {
      code: 'DEMO_NORTH',
      name: 'Demo North Clinic',
      accessCode: 'demo-north-access',
      branches: [
        { code: 'MAIN', name: 'Main Branch', isMain: true },
        { code: 'EAST', name: 'East Wing', isMain: false },
      ],
    },
    {
      code: 'DEMO_SOUTH',
      name: 'Demo South Clinic',
      accessCode: 'demo-south-access',
      branches: [
        { code: 'MAIN', name: 'Main Branch', isMain: true },
        { code: 'WEST', name: 'West Wing', isMain: false },
      ],
    },
  ] as const;

  for (const hospitalSeed of hospitals) {
    const hospital = await prisma.hospital.upsert({
      where: { code: hospitalSeed.code },
      create: {
        code: hospitalSeed.code,
        name: hospitalSeed.name,
        accessCode: hospitalSeed.accessCode,
        status: 'ACTIVE',
        isTest: true,
      },
      update: {
        name: hospitalSeed.name,
        accessCode: hospitalSeed.accessCode,
        status: 'ACTIVE',
        isTest: true,
        isActive: true,
      },
    });

    const { superAdminRoleId, branchAdminRoleId } = await ensureSystemRolesForTenant(
      prisma,
      hospital.id,
    );

    const branchIds: Record<string, string> = {};
    for (const branchSeed of hospitalSeed.branches) {
      const branch = await prisma.branch.upsert({
        where: {
          tenantId_code: { tenantId: hospital.id, code: branchSeed.code },
        },
        create: {
          tenantId: hospital.id,
          code: branchSeed.code,
          name: branchSeed.name,
          isMain: branchSeed.isMain,
        },
        update: {
          name: branchSeed.name,
          isMain: branchSeed.isMain,
          isActive: true,
        },
      });
      branchIds[branchSeed.code] = branch.id;
    }

    for (const module of modules) {
      await prisma.hospitalModuleSubscription.upsert({
        where: {
          tenantId_moduleId: { tenantId: hospital.id, moduleId: module.id },
        },
        create: { tenantId: hospital.id, moduleId: module.id },
        update: { isActive: true },
      });
      for (const branchId of Object.values(branchIds)) {
        await prisma.branchModule.upsert({
          where: {
            tenantId_branchId_moduleId: {
              tenantId: hospital.id,
              branchId,
              moduleId: module.id,
            },
          },
          create: {
            tenantId: hospital.id,
            branchId,
            moduleId: module.id,
            enabledByIndigo: true,
            restrictedByHospital: false,
          },
          update: {
            enabledByIndigo: true,
            restrictedByHospital: false,
            isActive: true,
          },
        });
      }
    }

    const superAdmin = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'SA001',
      email: `superadmin@${hospitalSeed.code.toLowerCase()}.example.test`,
      displayName: 'Seed SuperAdmin',
      password: superPassword,
    });
    await ensureMembership(prisma, hospital.id, superAdmin.id, branchIds.MAIN!);
    await ensureHospitalRole(prisma, hospital.id, superAdmin.id, superAdminRoleId);

    const branchAdmin = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'BA001',
      email: `branchadmin@${hospitalSeed.code.toLowerCase()}.example.test`,
      displayName: 'Seed Branch Admin',
      password: branchPassword,
    });
    await ensureMembership(prisma, hospital.id, branchAdmin.id, branchIds.MAIN!);
    await ensureBranchRole(prisma, hospital.id, branchAdmin.id, branchAdminRoleId, branchIds.MAIN!);

    const staff = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'ST001',
      email: `staff@${hospitalSeed.code.toLowerCase()}.example.test`,
      displayName: 'Seed Staff Dual',
      password: staffPassword,
    });
    await ensureMembership(prisma, hospital.id, staff.id, branchIds.MAIN!);
    await ensureMembership(
      prisma,
      hospital.id,
      staff.id,
      Object.values(branchIds).find((id) => id !== branchIds.MAIN)!,
    );
    await ensureBranchRole(prisma, hospital.id, staff.id, branchAdminRoleId, branchIds.MAIN!);
    const otherBranchId = Object.entries(branchIds).find(([code]) => code !== 'MAIN')?.[1];
    if (otherBranchId) {
      await ensureHospitalRole(prisma, hospital.id, staff.id, superAdminRoleId);
      await ensureBranchRole(prisma, hospital.id, staff.id, branchAdminRoleId, otherBranchId);
    }
  }

  console.log('Dev tenant seed complete.');
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.includes('CHANGE_ME')) {
    throw new Error(`${key} must be set in .env for dev seeding`);
  }
  return value;
}

async function upsertUser(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    code: string;
    email: string;
    displayName: string;
    password: string;
  },
) {
  const passwordHash = await argon2.hash(input.password);
  return prisma.user.upsert({
    where: { tenantId_code: { tenantId: input.tenantId, code: input.code } },
    create: {
      tenantId: input.tenantId,
      code: input.code,
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    },
    update: {
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      isActive: true,
    },
  });
}

async function ensureMembership(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  branchId: string,
): Promise<void> {
  await prisma.userBranch.upsert({
    where: {
      tenantId_userId_branchId: { tenantId, userId, branchId },
    },
    create: { tenantId, userId, branchId },
    update: { isActive: true },
  });
}

async function ensureHospitalRole(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const existing = await prisma.roleAssignment.findFirst({
    where: { tenantId, userId, roleId, scopeType: 'HOSPITAL' },
  });
  if (existing) {
    await prisma.roleAssignment.update({
      where: { id: existing.id },
      data: { isActive: true },
    });
    return;
  }
  await prisma.roleAssignment.create({
    data: { tenantId, userId, roleId, scopeType: 'HOSPITAL' },
  });
}

async function ensureBranchRole(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  roleId: string,
  branchId: string,
): Promise<void> {
  let assignment = await prisma.roleAssignment.findFirst({
    where: { tenantId, userId, roleId, scopeType: 'BRANCH' },
  });
  if (!assignment) {
    assignment = await prisma.roleAssignment.create({
      data: { tenantId, userId, roleId, scopeType: 'BRANCH' },
    });
  }
  await prisma.roleAssignmentBranch.upsert({
    where: {
      tenantId_assignmentId_branchId: {
        tenantId,
        assignmentId: assignment.id,
        branchId,
      },
    },
    create: { tenantId, assignmentId: assignment.id, branchId },
    update: { isActive: true },
  });
}
