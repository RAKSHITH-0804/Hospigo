import type { PrismaClient } from '../../src/generated/prisma';

const MODULES = [
  { code: 'OPD', name: 'Outpatient' },
  { code: 'IPD', name: 'Inpatient' },
  { code: 'PHARMACY', name: 'Pharmacy' },
  { code: 'LAB', name: 'Laboratory' },
  { code: 'RADIOLOGY', name: 'Radiology' },
  { code: 'ONLINE_BOOKING', name: 'Online Booking' },
] as const;

const PERMISSIONS = [
  { code: 'hospital.settings.read', description: 'Read hospital settings' },
  { code: 'hospital.settings.write', description: 'Write hospital settings' },
  { code: 'branch.read', description: 'Read branches' },
  { code: 'branch.write', description: 'Write branches' },
  { code: 'user.read', description: 'Read users' },
  { code: 'user.write', description: 'Write users' },
  { code: 'role.read', description: 'Read roles' },
  { code: 'role.write', description: 'Write roles' },
  { code: 'module.read', description: 'Read module subscriptions' },
  { code: 'audit.read', description: 'Read audit logs' },
] as const;

/** Idempotent prod-safe catalog seed (modules, permissions). System role templates are per-tenant. */
export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const item of MODULES) {
    await prisma.module.upsert({
      where: { code: item.code },
      create: { code: item.code, name: item.name },
      update: { name: item.name, isActive: true },
    });
  }

  for (const item of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: item.code },
      create: { code: item.code, description: item.description },
      update: { description: item.description, isActive: true },
    });
  }

  for (const item of PATIENT_FIELD_CATALOG) {
    await prisma.patientFieldCatalog.upsert({
      where: { key: item.key },
      create: item,
      update: {
        defaultLabel: item.defaultLabel,
        dataType: item.dataType,
        canDisable: item.canDisable,
        alwaysRequired: item.alwaysRequired,
      },
    });
  }

  console.log('Reference catalog seeded.');
}

/** System patient fields — defaults only; hospitals override via patient_field_settings. */
const PATIENT_FIELD_CATALOG = [
  {
    key: 'name',
    defaultLabel: 'Full name',
    dataType: 'TEXT',
    canDisable: false,
    alwaysRequired: true,
  },
  {
    key: 'gender',
    defaultLabel: 'Gender',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'date_of_birth',
    defaultLabel: 'Date of birth',
    dataType: 'DATE',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'phone',
    defaultLabel: 'Phone',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'email',
    defaultLabel: 'Email',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'address_street',
    defaultLabel: 'Street',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'address_cross',
    defaultLabel: 'Cross',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'address_area',
    defaultLabel: 'Area',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'address_city',
    defaultLabel: 'City',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'address_state',
    defaultLabel: 'State',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
  {
    key: 'address_pincode',
    defaultLabel: 'PIN code',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
  },
] as const;

export const SYSTEM_ROLE_CODES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  BRANCH_ADMIN: 'BRANCH_ADMIN',
} as const;

export async function ensureSystemRolesForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ superAdminRoleId: string; branchAdminRoleId: string }> {
  const permissions = await prisma.permission.findMany({ where: { isActive: true } });

  const superAdmin = await prisma.role.upsert({
    where: { tenantId_code: { tenantId, code: SYSTEM_ROLE_CODES.SUPER_ADMIN } },
    create: {
      tenantId,
      code: SYSTEM_ROLE_CODES.SUPER_ADMIN,
      name: 'SuperAdmin',
      description: 'Full hospital-scope permissions',
      isSystem: true,
    },
    update: { name: 'SuperAdmin', isActive: true, isSystem: true },
  });

  const branchAdmin = await prisma.role.upsert({
    where: { tenantId_code: { tenantId, code: SYSTEM_ROLE_CODES.BRANCH_ADMIN } },
    create: {
      tenantId,
      code: SYSTEM_ROLE_CODES.BRANCH_ADMIN,
      name: 'Branch Admin',
      description: 'Branch-scope administration',
      isSystem: true,
    },
    update: { name: 'Branch Admin', isActive: true, isSystem: true },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        tenantId_roleId_permissionId: {
          tenantId,
          roleId: superAdmin.id,
          permissionId: permission.id,
        },
      },
      create: { tenantId, roleId: superAdmin.id, permissionId: permission.id },
      update: { isActive: true },
    });
    await prisma.rolePermission.upsert({
      where: {
        tenantId_roleId_permissionId: {
          tenantId,
          roleId: branchAdmin.id,
          permissionId: permission.id,
        },
      },
      create: { tenantId, roleId: branchAdmin.id, permissionId: permission.id },
      update: { isActive: true },
    });
  }

  return { superAdminRoleId: superAdmin.id, branchAdminRoleId: branchAdmin.id };
}
