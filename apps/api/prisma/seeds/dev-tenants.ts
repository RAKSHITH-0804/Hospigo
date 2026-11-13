import argon2 from 'argon2';
import type { PrismaClient } from '../../src/generated/prisma';
import { assertDevTenantSeedAllowed } from '../../src/config/production-seed-guard';
import {
  OPD_FY_START_MONTH_DEFAULT,
  OPD_SETTINGS_DEFAULTS,
} from '../../src/modules/opd-masters/opd-settings.defaults';
import type { NumberSeriesFormat } from '../../src/modules/opd-masters/number-series-format';
import { ensureSystemRolesForTenant } from './reference';

/** Mock OPD counts — named constants, not magic numbers in loops. */
const MOCK_DOCTOR_COUNT: Record<string, number> = {
  DEMO_NORTH: 5,
  DEMO_SOUTH: 3,
};
const MOCK_RECEPTIONIST_COUNT = 2;
const MOCK_NURSE_COUNT = 2;
const MOCK_INVESTIGATION_COUNT = 80;
const MOCK_MEDICINE_COUNT = 300;
const MOCK_MEDICINE_FORMS = ['TABLET', 'SYRUP', 'INJECTION'] as const;
const MOCK_REGISTRATION_FEE_PAISE = 10_000;
const MOCK_INVESTIGATION_FEE_PAISE = 25_000;
const MOCK_NEW_CONSULT_FEE_PAISE = 50_000;
const MOCK_FOLLOW_UP_FEE_PAISE = 30_000;
const MOCK_PRICE_EFFECTIVE_FROM = new Date('2020-01-01T00:00:00.000Z');
const MOCK_TIMING_START = timeOfDay(9, 0);
const MOCK_TIMING_END = timeOfDay(17, 0);

const OPD_ROLE_CODES = {
  RECEPTIONIST: 'RECEPTIONIST',
  NURSE: 'NURSE',
  DOCTOR: 'DOCTOR',
} as const;

const NUMBER_SERIES_FY_FORMAT: NumberSeriesFormat = [
  { type: 'FINANCIAL_YEAR', style: 'SHORT' },
  { type: 'SEPARATOR', text: '/' },
  { type: 'RUNNING', width: 5 },
];

function timeOfDay(hour: number, minute: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
}

function labelRegion(hospitalCode: string): string {
  const raw = hospitalCode.replace(/^DEMO_/, '').toLowerCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Dev-only fake tenants. Seed data lives here (not in app runtime code).
 * Refuses unless NODE_ENV=development. Passwords come from env.
 *
 * Access codes live on branches (not hospitals). Every branch gets a fake code.
 * Seed users set must_change_password=false so local login demos are not blocked;
 * application-created accounts keep the schema default (true).
 */
export async function seedDevTenants(prisma: PrismaClient): Promise<void> {
  assertDevTenantSeedAllowed(process.env.NODE_ENV);

  const superPassword = requiredEnv('SEED_SUPERADMIN_PASSWORD');
  const branchPassword = requiredEnv('SEED_BRANCH_ADMIN_PASSWORD');
  const staffPassword = requiredEnv('SEED_STAFF_PASSWORD');

  const modules = await prisma.module.findMany({ where: { isActive: true } });
  if (modules.length === 0) {
    throw new Error('Modules catalog is empty; run reference seed first');
  }

  /** Distinct enabled module codes so hospital sidebars differ in the exit demo. */
  const HOSPITAL_MODULE_CODES: Record<string, readonly string[]> = {
    DEMO_NORTH: ['OPD', 'IPD', 'PHARMACY'],
    DEMO_SOUTH: ['OPD', 'LAB'],
  };

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

    const enabledCodes = new Set(HOSPITAL_MODULE_CODES[hospitalSeed.code] ?? []);
    for (const module of modules) {
      const enabled = enabledCodes.has(module.code);
      await prisma.hospitalModuleSubscription.upsert({
        where: {
          tenantId_moduleId: { tenantId: hospital.id, moduleId: module.id },
        },
        create: { tenantId: hospital.id, moduleId: module.id, isActive: enabled },
        update: { isActive: enabled },
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
            enabledByIndigo: enabled,
            restrictedByHospital: false,
            isActive: enabled,
          },
          update: {
            enabledByIndigo: enabled,
            restrictedByHospital: false,
            isActive: enabled,
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
    await seedOpdMasters(prisma, {
      hospitalCode: hospitalSeed.code,
      tenantId: hospital.id,
      branchIds,
      mainBranchId: branchIds.MAIN!,
      createdBy: superAdmin.id,
      staffPassword,
      emailDomain,
    });
  }

  console.log('Dev tenant seed complete.');
}

async function seedOpdMasters(
  prisma: PrismaClient,
  args: {
    hospitalCode: string;
    tenantId: string;
    branchIds: Record<string, string>;
    mainBranchId: string;
    createdBy: string;
    staffPassword: string;
    emailDomain: string;
  },
): Promise<void> {
  const region = labelRegion(args.hospitalCode);
  const doctorCount = MOCK_DOCTOR_COUNT[args.hospitalCode] ?? 0;

  const mastersRead = await prisma.permission.findUniqueOrThrow({
    where: { code: 'opd.masters.read' },
  });

  const roleDefs = [
    {
      code: OPD_ROLE_CODES.RECEPTIONIST,
      name: 'Receptionist',
      description: 'OPD front desk',
    },
    { code: OPD_ROLE_CODES.NURSE, name: 'Nurse', description: 'OPD nursing' },
    { code: OPD_ROLE_CODES.DOCTOR, name: 'Doctor', description: 'OPD consulting doctor' },
  ] as const;

  const roleIds: Record<string, string> = {};
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { tenantId_code: { tenantId: args.tenantId, code: def.code } },
      create: {
        tenantId: args.tenantId,
        code: def.code,
        name: def.name,
        description: def.description,
        isSystem: false,
      },
      update: {
        name: def.name,
        description: def.description,
        isActive: true,
        isSystem: false,
      },
    });
    roleIds[def.code] = role.id;
    await prisma.rolePermission.upsert({
      where: {
        tenantId_roleId_permissionId: {
          tenantId: args.tenantId,
          roleId: role.id,
          permissionId: mastersRead.id,
        },
      },
      create: {
        tenantId: args.tenantId,
        roleId: role.id,
        permissionId: mastersRead.id,
      },
      update: { isActive: true },
    });
  }

  const doctorProfileIds: string[] = [];
  for (let i = 1; i <= doctorCount; i += 1) {
    const code = `DR${String(i).padStart(3, '0')}`;
    const user = await upsertUser(prisma, {
      tenantId: args.tenantId,
      code,
      email: `doctor${i}@${args.emailDomain}`,
      displayName: `Doctor ${region} ${i}`,
      password: args.staffPassword,
    });
    await ensureMembership(prisma, args.tenantId, user.id, args.mainBranchId);
    await ensureBranchRole(
      prisma,
      args.tenantId,
      user.id,
      roleIds[OPD_ROLE_CODES.DOCTOR]!,
      args.mainBranchId,
    );

    const availabilityOn = !(args.hospitalCode === 'DEMO_NORTH' && i === 1);
    const profile = await prisma.doctorProfile.upsert({
      where: { tenantId_code: { tenantId: args.tenantId, code } },
      create: {
        tenantId: args.tenantId,
        userId: user.id,
        code,
        department: 'General',
        availabilityOn,
        active: true,
      },
      update: {
        userId: user.id,
        department: 'General',
        availabilityOn,
        active: true,
      },
    });
    doctorProfileIds.push(profile.id);

    for (const visitType of ['NEW', 'FOLLOW_UP'] as const) {
      const amountPaise =
        visitType === 'NEW' ? MOCK_NEW_CONSULT_FEE_PAISE : MOCK_FOLLOW_UP_FEE_PAISE;
      const existing = await prisma.doctorFee.findFirst({
        where: {
          tenantId: args.tenantId,
          doctorProfileId: profile.id,
          visitType,
          effectiveFrom: MOCK_PRICE_EFFECTIVE_FROM,
        },
      });
      if (!existing) {
        await prisma.doctorFee.create({
          data: {
            tenantId: args.tenantId,
            doctorProfileId: profile.id,
            visitType,
            amountPaise,
            effectiveFrom: MOCK_PRICE_EFFECTIVE_FROM,
            createdBy: args.createdBy,
          },
        });
      }
    }
  }

  for (let i = 1; i <= MOCK_RECEPTIONIST_COUNT; i += 1) {
    const code = `RC${String(i).padStart(3, '0')}`;
    const user = await upsertUser(prisma, {
      tenantId: args.tenantId,
      code,
      email: `receptionist${i}@${args.emailDomain}`,
      displayName: `Receptionist ${region} ${i}`,
      password: args.staffPassword,
    });
    await ensureMembership(prisma, args.tenantId, user.id, args.mainBranchId);
    await ensureBranchRole(
      prisma,
      args.tenantId,
      user.id,
      roleIds[OPD_ROLE_CODES.RECEPTIONIST]!,
      args.mainBranchId,
    );
  }

  for (let i = 1; i <= MOCK_NURSE_COUNT; i += 1) {
    const code = `NU${String(i).padStart(3, '0')}`;
    const user = await upsertUser(prisma, {
      tenantId: args.tenantId,
      code,
      email: `nurse${i}@${args.emailDomain}`,
      displayName: `Nurse ${region} ${i}`,
      password: args.staffPassword,
    });
    await ensureMembership(prisma, args.tenantId, user.id, args.mainBranchId);
    await ensureBranchRole(
      prisma,
      args.tenantId,
      user.id,
      roleIds[OPD_ROLE_CODES.NURSE]!,
      args.mainBranchId,
    );
  }

  const registration = await prisma.chargeItem.upsert({
    where: { tenantId_code: { tenantId: args.tenantId, code: 'REG' } },
    create: {
      tenantId: args.tenantId,
      code: 'REG',
      name: 'Registration',
      kind: 'REGISTRATION',
      taxable: false,
      taxRateBp: 0,
      active: true,
    },
    update: { name: 'Registration', kind: 'REGISTRATION', active: true },
  });
  await ensureChargeItemPrice(
    prisma,
    args.tenantId,
    registration.id,
    MOCK_REGISTRATION_FEE_PAISE,
    args.createdBy,
  );

  for (let i = 1; i <= MOCK_INVESTIGATION_COUNT; i += 1) {
    const code = `INV${String(i).padStart(3, '0')}`;
    const name = `Mock Test ${String(i).padStart(3, '0')}`;
    const item = await prisma.chargeItem.upsert({
      where: { tenantId_code: { tenantId: args.tenantId, code } },
      create: {
        tenantId: args.tenantId,
        code,
        name,
        kind: 'INVESTIGATION',
        taxable: false,
        taxRateBp: 0,
        active: true,
      },
      update: { name, kind: 'INVESTIGATION', active: true },
    });
    await ensureChargeItemPrice(
      prisma,
      args.tenantId,
      item.id,
      MOCK_INVESTIGATION_FEE_PAISE,
      args.createdBy,
    );
  }

  for (let i = 1; i <= MOCK_MEDICINE_COUNT; i += 1) {
    const code = `MED${String(i).padStart(3, '0')}`;
    const form = MOCK_MEDICINE_FORMS[(i - 1) % MOCK_MEDICINE_FORMS.length]!;
    await prisma.medicine.upsert({
      where: { tenantId_code: { tenantId: args.tenantId, code } },
      create: {
        tenantId: args.tenantId,
        code,
        name: `Mock Medicine ${String(i).padStart(3, '0')}`,
        composition: `Mock composition ${i}`,
        form,
        active: true,
      },
      update: {
        name: `Mock Medicine ${String(i).padStart(3, '0')}`,
        composition: `Mock composition ${i}`,
        form,
        active: true,
      },
    });
  }

  const vitals: Array<{
    code: string;
    name: string;
    unit: string;
    warnMin: number | null;
    warnMax: number | null;
    order: number;
  }> = [
    { code: 'pulse', name: 'Pulse', unit: 'bpm', warnMin: 50, warnMax: 120, order: 1 },
    { code: 'spo2', name: 'SpO2', unit: '%', warnMin: 90, warnMax: 100, order: 2 },
    {
      code: 'bp_systolic',
      name: 'BP Systolic',
      unit: 'mmHg',
      warnMin: 90,
      warnMax: 160,
      order: 3,
    },
    {
      code: 'bp_diastolic',
      name: 'BP Diastolic',
      unit: 'mmHg',
      warnMin: 60,
      warnMax: 100,
      order: 4,
    },
    {
      code: 'resp_rate',
      name: 'Respiratory rate',
      unit: '/min',
      warnMin: 10,
      warnMax: 30,
      order: 5,
    },
    {
      code: 'temperature',
      name: 'Temperature',
      unit: 'degF',
      warnMin: 95,
      warnMax: 104,
      order: 6,
    },
    { code: 'weight', name: 'Weight', unit: 'kg', warnMin: 2, warnMax: 200, order: 7 },
  ];
  for (const v of vitals) {
    await prisma.vitalsField.upsert({
      where: { tenantId_code: { tenantId: args.tenantId, code: v.code } },
      create: {
        tenantId: args.tenantId,
        code: v.code,
        name: v.name,
        unit: v.unit,
        valueKind: 'NUMBER',
        displayOrder: v.order,
        warnMin: v.warnMin,
        warnMax: v.warnMax,
        active: true,
      },
      update: {
        name: v.name,
        unit: v.unit,
        valueKind: 'NUMBER',
        displayOrder: v.order,
        warnMin: v.warnMin,
        warnMax: v.warnMax,
        active: true,
      },
    });
  }

  const paymentModes: Array<{ code: string; name: string; requiresReference: boolean }> = [
    { code: 'CASH', name: 'Cash', requiresReference: false },
    { code: 'UPI', name: 'UPI', requiresReference: true },
    { code: 'CARD', name: 'Card', requiresReference: true },
  ];
  for (const mode of paymentModes) {
    await prisma.paymentMode.upsert({
      where: { tenantId_code: { tenantId: args.tenantId, code: mode.code } },
      create: {
        tenantId: args.tenantId,
        code: mode.code,
        name: mode.name,
        requiresReference: mode.requiresReference,
        active: true,
      },
      update: {
        name: mode.name,
        requiresReference: mode.requiresReference,
        active: true,
      },
    });
  }

  await prisma.opdSettings.upsert({
    where: { tenantId: args.tenantId },
    create: {
      tenantId: args.tenantId,
      followUpFreeDays: OPD_SETTINGS_DEFAULTS.followUpFreeDays,
      tokenPrefix: OPD_SETTINGS_DEFAULTS.tokenPrefix,
      timezone: OPD_SETTINGS_DEFAULTS.timezone,
      taxEnabled: OPD_SETTINGS_DEFAULTS.taxEnabled,
      taxName: OPD_SETTINGS_DEFAULTS.taxName,
      taxRegistrationNo: OPD_SETTINGS_DEFAULTS.taxRegistrationNo,
      taxInclusive: OPD_SETTINGS_DEFAULTS.taxInclusive,
    },
    update: {
      followUpFreeDays: OPD_SETTINGS_DEFAULTS.followUpFreeDays,
      tokenPrefix: OPD_SETTINGS_DEFAULTS.tokenPrefix,
      timezone: OPD_SETTINGS_DEFAULTS.timezone,
      taxEnabled: OPD_SETTINGS_DEFAULTS.taxEnabled,
      taxInclusive: OPD_SETTINGS_DEFAULTS.taxInclusive,
    },
  });

  for (const series of ['BILL', 'RECEIPT', 'REFUND'] as const) {
    await prisma.numberSeriesSettings.upsert({
      where: { tenantId_series: { tenantId: args.tenantId, series } },
      create: {
        tenantId: args.tenantId,
        series,
        format: NUMBER_SERIES_FY_FORMAT,
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: OPD_FY_START_MONTH_DEFAULT,
      },
      update: {
        format: NUMBER_SERIES_FY_FORMAT,
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: OPD_FY_START_MONTH_DEFAULT,
      },
    });
  }

  // Weekday timings 09:00–17:00 for NORTH doctors on MAIN.
  if (args.hospitalCode === 'DEMO_NORTH') {
    for (const doctorProfileId of doctorProfileIds) {
      for (let weekday = 1; weekday <= 5; weekday += 1) {
        const existing = await prisma.doctorTiming.findFirst({
          where: {
            tenantId: args.tenantId,
            doctorProfileId,
            branchId: args.mainBranchId,
            weekday,
          },
        });
        if (existing) {
          await prisma.doctorTiming.update({
            where: { id: existing.id },
            data: { startTime: MOCK_TIMING_START, endTime: MOCK_TIMING_END },
          });
        } else {
          await prisma.doctorTiming.create({
            data: {
              tenantId: args.tenantId,
              doctorProfileId,
              branchId: args.mainBranchId,
              weekday,
              startTime: MOCK_TIMING_START,
              endTime: MOCK_TIMING_END,
            },
          });
        }
      }
    }
  }

  // One SOUTH doctor on leave tomorrow (Asia/Kolkata).
  if (args.hospitalCode === 'DEMO_SOUTH' && doctorProfileIds[0]) {
    const tomorrow = tomorrowDateInTimezone(OPD_SETTINGS_DEFAULTS.timezone);
    const existingLeave = await prisma.doctorLeave.findFirst({
      where: { tenantId: args.tenantId, doctorProfileId: doctorProfileIds[0] },
    });
    if (existingLeave) {
      await prisma.doctorLeave.update({
        where: { id: existingLeave.id },
        data: {
          fromDate: tomorrow,
          toDate: tomorrow,
          reason: 'Mock leave',
        },
      });
    } else {
      await prisma.doctorLeave.create({
        data: {
          tenantId: args.tenantId,
          doctorProfileId: doctorProfileIds[0],
          fromDate: tomorrow,
          toDate: tomorrow,
          reason: 'Mock leave',
        },
      });
    }
  }
}

async function ensureChargeItemPrice(
  prisma: PrismaClient,
  tenantId: string,
  chargeItemId: string,
  amountPaise: number,
  createdBy: string,
): Promise<void> {
  const existing = await prisma.chargeItemPrice.findFirst({
    where: {
      tenantId,
      chargeItemId,
      effectiveFrom: MOCK_PRICE_EFFECTIVE_FROM,
    },
  });
  if (existing) {
    return;
  }
  await prisma.chargeItemPrice.create({
    data: {
      tenantId,
      chargeItemId,
      amountPaise,
      effectiveFrom: MOCK_PRICE_EFFECTIVE_FROM,
      createdBy,
    },
  });
}

function tomorrowDateInTimezone(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(
    parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const todayUtc = Date.UTC(year, month - 1, day);
  const tomorrow = new Date(todayUtc + 24 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()),
  );
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
