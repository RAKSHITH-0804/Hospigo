/** Limits and fixed lists of the staff and roles screens. One place, no magic numbers. */

export const STAFF_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  phoneMax: 20,
  roleNameMax: 60,
  roleDescriptionMax: 200,
  maxRolesPerPerson: 5,
  maxCustomRoles: 50,
  maxPermissionsPerRole: 200,
  searchMax: 80,
  pageSizeDefault: 25,
  pageSizeMax: 100,
  /** A person whose email changed in this time (ms) gets no reset link yet. */
  resetAfterEmailChangeMs: 3_600_000,
} as const;

export const STAFF_CODE_LIMITS = {
  defaultPrefix: 'STF',
  defaultMinWidth: 3,
  prefixMax: 6,
  minWidthMin: 1,
  minWidthMax: 8,
} as const;

/** The system roles every hospital has (created with the hospital, never edited here). */
export const SUPER_ADMIN_ROLE_CODE = 'SUPER_ADMIN';
export const BRANCH_ADMIN_ROLE_CODE = 'BRANCH_ADMIN';
/** Retired in Phase 2.2 (HQ no longer enters hospitals); switched off by a migration, never shown or given. */
export const RETIRED_ROLE_CODES: readonly string[] = ['TENANT_ADMIN', 'INDIGO_EMPLOYEE'];

/** The permission that makes a person a doctor: giving a role that holds it creates the doctor profile. */
export const DOCTOR_PERMISSION_CODE = 'opd.doctors.own';

/** Doctor profile codes made here: DR001, DR002, ... */
export const DOCTOR_CODE_PREFIX = 'DR';
export const DOCTOR_CODE_WIDTH = 3;

/**
 * The daily-work permissions (the floor: reception, nurse, doctor). Anyone who may give a role to
 * staff may give these even if they do not hold them themselves, because the Admin roles are kept
 * away from them on purpose (an Admin does not take cash or write notes). Every other permission
 * is an administrative power: it can only be given by someone who holds it.
 */
export const FLOOR_PERMISSION_CODES: readonly string[] = [
  'opd.masters.read',
  'patients.registry.read',
  'patients.registry.write',
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'opd.queue.read',
  'opd.vitals.read',
  'opd.vitals.write',
  'opd.notes.read',
  'opd.notes.write',
  'opd.prints.clinical',
  'opd.investigations.order',
  'opd.investigations.bill',
  'opd.refunds.request',
  'opd.doctors.own',
  // Step 2.1b: a doctor may read any patient of the hospital with the history (views are logged)
  'patients.history.view_all',
];

/** Ready-made roles a SuperAdmin can start from (the same lists the demo hospitals use). */
export const ROLE_TEMPLATES: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}> = [
  {
    key: 'RECEPTIONIST',
    name: 'Receptionist',
    description: 'Registers patients, makes visits and takes payment',
    permissions: [
      'opd.masters.read',
      'patients.registry.read',
      'patients.registry.write',
      'opd.visits.create',
      'opd.visits.read',
      'opd.billing.collect',
      'opd.billing.read',
      'opd.queue.read',
      'opd.investigations.bill',
      'opd.refunds.request',
      'opd.prints.clinical',
    ],
  },
  {
    key: 'NURSE',
    name: 'Nurse',
    description: 'Records vitals and sees the queue and notes',
    permissions: [
      'opd.masters.read',
      'patients.registry.read',
      'opd.visits.read',
      'opd.queue.read',
      'opd.vitals.read',
      'opd.vitals.write',
      'opd.notes.read',
      'opd.prints.clinical',
    ],
  },
  {
    key: 'DOCTOR',
    name: 'Doctor',
    description: 'Consults, writes notes and prescriptions, orders tests',
    permissions: [
      'opd.masters.read',
      'patients.registry.read',
      'opd.visits.read',
      'opd.queue.read',
      'opd.vitals.read',
      'opd.vitals.write',
      'opd.notes.read',
      'opd.notes.write',
      'opd.investigations.order',
      'opd.doctors.own',
      'patients.history.view_all',
    ],
  },
];
