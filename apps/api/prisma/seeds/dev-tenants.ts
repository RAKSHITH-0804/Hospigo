import argon2 from 'argon2';
import type { PrismaClient } from '../../src/generated/prisma';
import { ensureSystemRolesForTenant } from './reference';

/**
 * Dev-only fake tenants. Seed data lives here (not in app runtime code).
 * Refuses unless NODE_ENV=development. Passwords come from env.
 *
 * Access codes live on branches (not hospitals). Every branch gets a fake code.
 * Seed users set must_change_password=false so local login demos are not blocked;
 * application-created accounts keep the schema default (true).
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
      branches: [
        { code: 'MAIN', name: 'Main Branch', isMain: true, accessCode: 'demo-north-main' },
        { code: 'EAST', name: 'East Wing', isMain: false, accessCode: 'demo-north-east' },
      ],
    },
    {
      code: 'DEMO_SOUTH',
      name: 'Demo South Clinic',
      branches: [
        { code: 'MAIN', name: 'Main Branch', isMain: true, accessCode: 'demo-south-main' },
        { code: 'WEST', name: 'West Wing', isMain: false, accessCode: 'demo-south-west' },
      ],
    },
  ] as const;

  for (const hospitalSeed of hospitals) {
    const hospital = await prisma.hospital.upsert({
      where: { code: hospitalSeed.code },
      create: {
        code: hospitalSeed.code,
        name: hospitalSeed.name,
        status: 'ACTIVE',
        isTest: true,
      },
      update: {
        name: hospitalSeed.name,
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
          accessCode: branchSeed.accessCode,
          isMain: branchSeed.isMain,
        },
        update: {
          name: branchSeed.name,
          accessCode: branchSeed.accessCode,
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

    // Domains use hyphens (not underscores) so class-validator @IsEmail accepts them.
    const emailDomain = `${hospitalSeed.code.toLowerCase().replace(/_/g, '-')}.example.test`;

    const superAdmin = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'SA001',
      email: `superadmin@${emailDomain}`,
      displayName: 'Seed SuperAdmin',
      password: superPassword,
    });
    await ensureMembership(prisma, hospital.id, superAdmin.id, branchIds.MAIN!);
    await ensureHospitalRole(prisma, hospital.id, superAdmin.id, superAdminRoleId);

    const branchAdmin = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'BA001',
      email: `branchadmin@${emailDomain}`,
      displayName: 'Seed Branch Admin',
      password: branchPassword,
    });
    await ensureMembership(prisma, hospital.id, branchAdmin.id, branchIds.MAIN!);
    await ensureBranchRole(prisma, hospital.id, branchAdmin.id, branchAdminRoleId, branchIds.MAIN!);

    const staff = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'ST001',
      email: `staff@${emailDomain}`,
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

    // Dev-only user to exercise forced password change (must_change_password=true).
    const mustChange = await upsertUser(prisma, {
      tenantId: hospital.id,
      code: 'MC001',
      email: `mustchange@${emailDomain}`,
      displayName: 'Seed Must Change',
      password: staffPassword,
      mustChangePassword: true,
    });
    await ensureMembership(prisma, hospital.id, mustChange.id, branchIds.MAIN!);
    await ensureBranchRole(prisma, hospital.id, mustChange.id, branchAdminRoleId, branchIds.MAIN!);

    await seedDefaultFieldSettings(prisma, hospital.id, superAdmin.id);
    await seedExampleUhidFormat(prisma, hospital.id, superAdmin.id, hospitalSeed.code);
  }

  console.log('Dev tenant seed complete.');
}

/**
 * Default field settings for fake test hospitals only.
 * Real new-hospital defaults come from Phase 2 onboarding — until then registration without a
 * UHID format config refuses with a clear error.
 */
async function seedDefaultFieldSettings(
  prisma: PrismaClient,
  tenantId: string,
  changedBy: string,
): Promise<void> {
  const catalog = await prisma.patientFieldCatalog.findMany();
  let order = 0;
  for (const field of catalog) {
    await prisma.patientFieldSetting.upsert({
      where: { tenantId_catalogKey: { tenantId, catalogKey: field.key } },
      create: {
        tenantId,
        catalogKey: field.key,
        isEnabled: true,
        isRequired: field.alwaysRequired,
        label: field.defaultLabel,
        sortOrder: order++,
        changedBy,
      },
      update: {
        isEnabled: true,
        isRequired: field.alwaysRequired,
        label: field.defaultLabel,
        changedBy,
      },
    });
  }
}

/**
 * Two EXAMPLE formats with FAKE codes (not real hospital formats):
 * (a) DEMO_NORTH → fixed text + RUNNING_NUMBER min 4, reset NEVER (e.g. TESTA0001)
 * (b) DEMO_SOUTH → FY SHORT + "/" + RUNNING_NUMBER min 5, reset FINANCIAL_YEAR (e.g. 2627/00001)
 */
async function seedExampleUhidFormat(
  prisma: PrismaClient,
  tenantId: string,
  createdBy: string,
  hospitalCode: string,
): Promise<void> {
  const existing = await prisma.uhidFormatConfig.findFirst({ where: { tenantId } });
  if (existing) {
    return;
  }

  if (hospitalCode === 'DEMO_NORTH') {
    await prisma.uhidFormatConfig.create({
      data: {
        tenantId,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        resetRule: 'NEVER',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        createdBy,
        blocks: {
          create: [
            {
              position: 1,
              blockType: 'FIXED_TEXT',
              textValue: 'TESTA',
            },
            {
              position: 2,
              blockType: 'RUNNING_NUMBER',
              minWidth: 4,
            },
          ],
        },
      },
    });
    return;
  }

  await prisma.uhidFormatConfig.create({
    data: {
      tenantId,
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
      resetRule: 'FINANCIAL_YEAR',
      fyStartMonth: 4,
      timezone: 'Asia/Kolkata',
      createdBy,
      blocks: {
        create: [
          {
            position: 1,
            blockType: 'FINANCIAL_YEAR',
            fyStyle: 'SHORT',
          },
          {
            position: 2,
            blockType: 'SEPARATOR',
            textValue: '/',
          },
          {
            position: 3,
            blockType: 'RUNNING_NUMBER',
            minWidth: 5,
          },
        ],
      },
    },
  });
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
    /** Default false for demo users; set true for forced-change path testing. */
    mustChangePassword?: boolean;
  },
) {
  const mustChangePassword = input.mustChangePassword === true;
  const passwordHash = await argon2.hash(input.password);
  return prisma.user.upsert({
    where: { tenantId_code: { tenantId: input.tenantId, code: input.code } },
    create: {
      tenantId: input.tenantId,
      code: input.code,
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      mustChangePassword,
      passwordChangedAt: mustChangePassword ? null : new Date(),
    },
    update: {
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      isActive: true,
      mustChangePassword,
      passwordChangedAt: mustChangePassword ? null : new Date(),
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
