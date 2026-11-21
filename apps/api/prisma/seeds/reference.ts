import type { PrismaClient } from '../../src/generated/prisma';
import {
  BUILTIN_FIELD_DEFAULT_SECTION,
  PatientFieldSection,
} from '../../src/modules/patients/patient-field-sections';

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
  { code: 'opd.masters.read', description: 'Read OPD masters' },
  { code: 'opd.masters.write', description: 'Write OPD masters' },
  { code: 'opd.prices.write', description: 'Write OPD prices and fees' },
  { code: 'opd.settings.write', description: 'Write OPD settings' },
  { code: 'patients.registry.read', description: 'Read patient registry' },
  { code: 'patients.registry.write', description: 'Write patient registry' },
  { code: 'opd.visits.create', description: 'Create an OPD visit and its consultation bill' },
  { code: 'opd.visits.read', description: 'Read OPD visits' },
  { code: 'opd.billing.collect', description: 'Take payment for an OPD bill' },
  { code: 'opd.billing.read', description: 'Read OPD bills and receipts' },
  { code: 'opd.queue.read', description: 'Read the OPD queue (own queue for a doctor)' },
  { code: 'opd.vitals.read', description: 'Read visit vitals' },
  { code: 'opd.vitals.write', description: 'Record and correct visit vitals' },
  { code: 'opd.notes.read', description: 'Read consultation notes and prescriptions' },
  { code: 'opd.notes.write', description: 'Write consultation notes and prescriptions' },
  { code: 'opd.investigations.order', description: 'Order tests during a consultation' },
  { code: 'opd.investigations.bill', description: 'See ordered tests and bill them' },
  { code: 'opd.refunds.request', description: 'Ask for a refund or a visit cancellation' },
  {
    code: 'opd.refunds.approve',
    description: 'Approve or reject refund and cancellation requests',
  },
  { code: 'opd.reports.read', description: 'Read the OPD collection reports' },
  {
    code: 'opd.doctors.read',
    description: 'Read the doctors of the hospital with their profile details',
  },
  {
    code: 'opd.doctors.write',
    description: 'Correct the profile details and department of a doctor',
  },
  { code: 'opd.doctors.own', description: 'Read and edit your own doctor profile' },
] as const;

/**
 * Permissions the BRANCH ADMIN role never receives automatically (the SuperAdmin has a shorter list
 * below). Branch Admins read visits and bills, but do not create visits, collect cash, or see clinical data
 * (queue, vitals, consultation notes). Hospitals can still grant them through their own roles.
 * Codes that are not in the catalog yet (clinical steps) are listed so they stay excluded.
 * Admins DO get opd.refunds.approve (they decide refunds) but never ask for one, order tests or bill them.
 */
export const ADMIN_EXCLUDED_PERMISSION_CODES: readonly string[] = [
  'opd.visits.create',
  'opd.billing.collect',
  'opd.queue.read',
  'opd.vitals.read',
  'opd.vitals.write',
  'opd.notes.read',
  'opd.notes.write',
  'opd.investigations.order',
  'opd.investigations.bill',
  'opd.refunds.request',
  'opd.doctors.own',
];

/**
 * What the SuperAdmin never receives automatically: the ACTIONS that belong to a person (taking
 * cash, creating a visit, writing a note, recording vitals, ordering or billing tests, asking for a
 * refund). The SuperAdmin DOES receive the read permissions of the OPD floor (queue, vitals, notes),
 * so the main controller of a hospital can see everything and approve what needs approving, while
 * the work itself stays with the roles that do it. The API still ties many actions to a person (only
 * the visit's own doctor completes a consultation) and records reads of clinical data.
 * Branch Admin keeps the longer list above.
 */
export const SUPER_ADMIN_EXCLUDED_PERMISSION_CODES: readonly string[] = [
  'opd.visits.create',
  'opd.billing.collect',
  'opd.vitals.write',
  'opd.notes.write',
  'opd.investigations.order',
  'opd.investigations.bill',
  'opd.refunds.request',
  'opd.doctors.own',
];

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
        defaultSection: item.defaultSection,
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
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.name ?? PatientFieldSection.PERSONAL,
  },
  {
    key: 'gender',
    defaultLabel: 'Gender',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.gender ?? PatientFieldSection.PERSONAL,
  },
  {
    key: 'date_of_birth',
    defaultLabel: 'Date of birth',
    dataType: 'DATE',
    canDisable: false,
    alwaysRequired: true,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.date_of_birth ?? PatientFieldSection.PERSONAL,
  },
  {
    key: 'phone',
    defaultLabel: 'Phone',
    dataType: 'TEXT',
    canDisable: false,
    alwaysRequired: true,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.phone ?? PatientFieldSection.CONTACT,
  },
  {
    key: 'email',
    defaultLabel: 'Email',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.email ?? PatientFieldSection.CONTACT,
  },
  {
    key: 'address_street',
    defaultLabel: 'Street',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.address_street ?? PatientFieldSection.ADDRESS,
  },
  {
    key: 'address_cross',
    defaultLabel: 'Cross',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.address_cross ?? PatientFieldSection.ADDRESS,
  },
  {
    key: 'address_area',
    defaultLabel: 'Area',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.address_area ?? PatientFieldSection.ADDRESS,
  },
  {
    key: 'address_city',
    defaultLabel: 'City',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.address_city ?? PatientFieldSection.ADDRESS,
  },
  {
    key: 'address_state',
    defaultLabel: 'State',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.address_state ?? PatientFieldSection.ADDRESS,
  },
  {
    key: 'address_pincode',
    defaultLabel: 'PIN code',
    dataType: 'TEXT',
    canDisable: true,
    alwaysRequired: false,
    defaultSection: BUILTIN_FIELD_DEFAULT_SECTION.address_pincode ?? PatientFieldSection.ADDRESS,
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
  const allPermissions = await prisma.permission.findMany({ where: { isActive: true } });
  const branchAdminExcluded = new Set(ADMIN_EXCLUDED_PERMISSION_CODES);
  const superAdminExcluded = new Set(SUPER_ADMIN_EXCLUDED_PERMISSION_CODES);

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

  const roles = [
    { id: superAdmin.id, excluded: superAdminExcluded },
    { id: branchAdmin.id, excluded: branchAdminExcluded },
  ];
  for (const role of roles) {
    for (const permission of allPermissions) {
      if (role.excluded.has(permission.code)) {
        continue;
      }
      await prisma.rolePermission.upsert({
        where: {
          tenantId_roleId_permissionId: {
            tenantId,
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        create: { tenantId, roleId: role.id, permissionId: permission.id },
        update: { isActive: true },
      });
    }
    // Idempotent clean-up: an excluded permission granted by an earlier seed run is switched off.
    const excludedIds = allPermissions.filter((p) => role.excluded.has(p.code)).map((p) => p.id);
    if (excludedIds.length > 0) {
      await prisma.rolePermission.updateMany({
        where: { tenantId, roleId: role.id, permissionId: { in: excludedIds } },
        data: { isActive: false },
      });
    }
  }

  return { superAdminRoleId: superAdmin.id, branchAdminRoleId: branchAdmin.id };
}
