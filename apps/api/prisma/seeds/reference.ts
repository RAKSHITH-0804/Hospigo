import type { PrismaClient } from '../../src/generated/prisma';
import {
  BUILTIN_FIELD_DEFAULT_SECTION,
  PatientFieldSection,
} from '../../src/modules/patients/patient-field-sections';
import { IMPORT_TYPE_CODES, IMPORT_TYPE_NAMES } from '../../src/modules/imports/import.config';

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
  {
    code: 'opd.notes.amend',
    description: 'Change a completed consultation as a new version (with a reason)',
  },
  {
    code: 'patients.history.view_all',
    description:
      'Read any patient of the hospital with the full history (read-only; views are logged)',
  },
  {
    code: 'print.templates.choose',
    description:
      'Choose a print template or a logo from the Indigo library for this hospital or branch',
  },
  {
    code: 'print.templates.manage',
    description: 'Make and change print templates and logos (HQ only; never a hospital role)',
  },
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
        defaultSection: item.defaultSection,
      },
    });
  }

  // Step 8b: the kinds of Excel upload the batch engine knows (a global catalog; hospitals only read it).
  for (const code of IMPORT_TYPE_CODES) {
    await prisma.importType.upsert({
      where: { code },
      create: { code, name: IMPORT_TYPE_NAMES[code], isActive: true },
      update: { name: IMPORT_TYPE_NAMES[code], isActive: true },
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

export {
  ADMIN_EXCLUDED_PERMISSION_CODES,
  SUPER_ADMIN_EXCLUDED_PERMISSION_CODES,
  SYSTEM_ROLE_CODES,
  ensureSystemRolesForTenant,
} from '../../src/database/system-roles';
