import type { PrismaClient } from '../generated/prisma';

/**
 * The system roles every hospital has (Super Admin, Admin and, for Indigo people, Indigo Owner and Indigo
 * Employee) with the permissions each one receives. Used by the seeds and by the Indigo onboarding.
 */

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
  // Step 2.1b: an Admin READS notes (to change a completed one as a new version) but never writes a new one
  'opd.notes.write',
  'opd.investigations.order',
  'opd.investigations.bill',
  'opd.refunds.request',
  'opd.doctors.own',
  // Step 7d: roles are made by the SuperAdmin only (an Admin gives existing roles to staff)
  'role.write',
  // Step 2.1b: templates and logos belong to the Indigo Owner; the doctor view and the Indigo log are not for Admins
  'print.templates.manage',
  'patients.history.view_all',
  'indigo.access.read',
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
  'print.templates.manage',
  'patients.history.view_all',
];

/**
 * What the Indigo Employee never receives: patient and clinical data, money, templates and logos,
 * and the log of Indigo access. An Employee configures and loads data (staff, roles, medicines, tests,
 * prices, Excel uploads) in the hospitals the Owner assigned. The Owner receives every permission.
 */
export const INDIGO_EMPLOYEE_EXCLUDED_PREFIXES: readonly string[] = [
  'patients.',
  'opd.visits.',
  'opd.billing.',
  'opd.queue.',
  'opd.vitals.',
  'opd.notes.',
  'opd.investigations.',
  'opd.refunds.',
  'opd.reports.',
  'opd.doctors.own',
  'print.templates.manage',
  'indigo.access.read',
];

export const SYSTEM_ROLE_CODES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  BRANCH_ADMIN: 'BRANCH_ADMIN',
  /** Indigo Owner (Step 2.1b): full power inside a hospital. Only the Indigo entry gives it. */
  TENANT_ADMIN: 'TENANT_ADMIN',
  /** Indigo Employee: configuration and data loading in assigned hospitals, no patient data. */
  INDIGO_EMPLOYEE: 'INDIGO_EMPLOYEE',
} as const;

/** The two roles that only the Indigo entry gives; hospital users never see or give them. */
export const INDIGO_ROLE_CODES: readonly string[] = [
  SYSTEM_ROLE_CODES.TENANT_ADMIN,
  SYSTEM_ROLE_CODES.INDIGO_EMPLOYEE,
];

export async function ensureSystemRolesForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{
  superAdminRoleId: string;
  branchAdminRoleId: string;
  ownerRoleId: string;
  employeeRoleId: string;
}> {
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
      name: 'Admin',
      description: 'Administers one or more branches',
      isSystem: true,
    },
    update: { name: 'Admin', isActive: true, isSystem: true },
  });

  const owner = await prisma.role.upsert({
    where: { tenantId_code: { tenantId, code: SYSTEM_ROLE_CODES.TENANT_ADMIN } },
    create: {
      tenantId,
      code: SYSTEM_ROLE_CODES.TENANT_ADMIN,
      name: 'Indigo Owner',
      description: 'Indigo owner acting inside the hospital (hidden from hospital users)',
      isSystem: true,
    },
    update: { name: 'Indigo Owner', isActive: true, isSystem: true },
  });
  const employee = await prisma.role.upsert({
    where: { tenantId_code: { tenantId, code: SYSTEM_ROLE_CODES.INDIGO_EMPLOYEE } },
    create: {
      tenantId,
      code: SYSTEM_ROLE_CODES.INDIGO_EMPLOYEE,
      name: 'Indigo Employee',
      description: 'Indigo employee: configuration and data loading, no patient data',
      isSystem: true,
    },
    update: { name: 'Indigo Employee', isActive: true, isSystem: true },
  });
  const employeeExcluded = new Set(
    allPermissions
      .filter((p) => INDIGO_EMPLOYEE_EXCLUDED_PREFIXES.some((prefix) => p.code.startsWith(prefix)))
      .map((p) => p.code),
  );

  const roles = [
    { id: superAdmin.id, excluded: superAdminExcluded },
    { id: branchAdmin.id, excluded: branchAdminExcluded },
    { id: owner.id, excluded: new Set<string>() },
    { id: employee.id, excluded: employeeExcluded },
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

  return {
    superAdminRoleId: superAdmin.id,
    branchAdminRoleId: branchAdmin.id,
    ownerRoleId: owner.id,
    employeeRoleId: employee.id,
  };
}
