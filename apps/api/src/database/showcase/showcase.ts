import 'reflect-metadata';
import argon2 from 'argon2';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { PrismaClient } from '../../generated/prisma';
import { CLOCK, FakeClock } from '../../common/clock';
import { chooseDesigns, seedLibrary } from './showcase-library';
import { ensureSystemRolesForTenant, SYSTEM_ROLE_CODES } from '../system-roles';
import { defaultStarterOptions, runHospitalStarter } from '../hospital-starter/hospital-starter';
import { ROLE_TEMPLATES } from '../../modules/staff/staff.config';
import {
  ADVICE,
  CITIES,
  DIAGNOSES,
  DOSES,
  DURATIONS,
  FIRST_NAMES_F,
  FIRST_NAMES_M,
  FREQUENCIES,
  LAST_NAMES,
  MEDICINES,
  SHOWCASE_HOSPITALS,
  SYMPTOMS,
  TESTS,
  type ShowcaseHospital,
} from './showcase-data';

/**
 * The showcase seed (Step 2.1d): two fictional hospitals with believable people, prices and 60 to 90
 * days of visits, bills, payments, prescriptions and a few refunds, so a first-time viewer sees
 * a hospital that has been working for months. NEVER run in production (it refuses outside
 * development) and never against a hospital that is not one of the two showcase hospitals.
 *
 * The history is made through the application's own HTTP routes with a controllable clock, so every
 * rule, number series, token, ledger entry and audit row is exactly what real use would write.
 * Running it again does nothing for a hospital that already has visits (idempotent).
 */

export type ShowcaseOptions = {
  historyDays: number;
  /** Visits per weekday: a base number that grows a little over the period. */
  visitsPerDay: number;
};

const PRICE_FROM = new Date('2020-01-01T00:00:00.000Z');

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const pick = <T>(rand: () => number, list: readonly T[]): T =>
  list[Math.floor(rand() * list.length)]!;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

type Person = { id: string; email: string; code: string };

async function upsertUser(
  prisma: PrismaClient,
  tenantId: string,
  code: string,
  email: string,
  displayName: string,
  password: string,
): Promise<Person> {
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { tenantId_code: { tenantId, code } },
    create: {
      tenantId,
      code,
      email,
      displayName,
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
    update: { displayName, email, isActive: true },
  });
  return { id: user.id, email, code };
}

async function giveRole(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  roleId: string,
  scope: 'HOSPITAL' | 'BRANCH',
  branchIds: string[],
): Promise<void> {
  for (const branchId of branchIds) {
    await prisma.userBranch.upsert({
      where: { tenantId_userId_branchId: { tenantId, userId, branchId } },
      create: { tenantId, userId, branchId },
      update: { isActive: true },
    });
  }
  let assignment = await prisma.roleAssignment.findFirst({ where: { tenantId, userId, roleId } });
  if (!assignment) {
    assignment = await prisma.roleAssignment.create({
      data: { tenantId, userId, roleId, scopeType: scope },
    });
  }
  if (scope === 'BRANCH') {
    for (const branchId of branchIds) {
      await prisma.roleAssignmentBranch.upsert({
        where: {
          tenantId_assignmentId_branchId: { tenantId, assignmentId: assignment.id, branchId },
        },
        create: { tenantId, assignmentId: assignment.id, branchId },
        update: { isActive: true },
      });
    }
  }
}

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^(dr\.|sister)\s+/, '')
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');

type Setup = {
  hospital: ShowcaseHospital;
  tenantId: string;
  mainBranchId: string;
  superAdmin: Person;
  admin: Person;
  receptionists: Person[];
  nurses: Person[];
  doctors: Array<Person & { profileId: string; name: string; speciality: string }>;
  medicineIds: string[];
};

async function setupHospital(prisma: PrismaClient, hospital: ShowcaseHospital): Promise<Setup> {
  const row = await prisma.hospital.upsert({
    where: { code: hospital.code },
    create: {
      code: hospital.code,
      name: hospital.name,
      status: 'ACTIVE',
      isTest: false,
      isActive: true,
    },
    update: { name: hospital.name, status: 'ACTIVE', isActive: true, isTest: false },
  });
  const tenantId = row.id;
  const branchIds: Record<string, string> = {};
  for (const branch of hospital.branches) {
    const saved = await prisma.branch.upsert({
      where: { tenantId_code: { tenantId, code: branch.code } },
      create: { tenantId, ...branch },
      update: { name: branch.name, isMain: branch.isMain, isActive: true },
    });
    branchIds[branch.code] = saved.id;
  }
  const mainBranchId = branchIds[hospital.branches.find((b) => b.isMain)!.code]!;
  const opd = await prisma.module.findUniqueOrThrow({ where: { code: 'OPD' } });
  await prisma.hospitalModuleSubscription.upsert({
    where: { tenantId_moduleId: { tenantId, moduleId: opd.id } },
    create: { tenantId, moduleId: opd.id },
    update: { isActive: true },
  });
  for (const branchId of Object.values(branchIds)) {
    await prisma.branchModule.upsert({
      where: { tenantId_branchId_moduleId: { tenantId, branchId, moduleId: opd.id } },
      create: { tenantId, branchId, moduleId: opd.id, enabledByIndigo: true },
      update: { isActive: true, enabledByIndigo: true },
    });
  }
  const system = await ensureSystemRolesForTenant(prisma, tenantId);
  const domain = `${hospital.slug}.example.org`;
  const superPassword = requiredEnv('SEED_SUPERADMIN_PASSWORD');
  const adminPassword = requiredEnv('SEED_BRANCH_ADMIN_PASSWORD');
  const staffPassword = requiredEnv('SEED_STAFF_PASSWORD');

  const superAdmin = await upsertUser(
    prisma,
    tenantId,
    'SA001',
    `${slugOf(hospital.superAdmin)}@${domain}`,
    hospital.superAdmin,
    superPassword,
  );
  await giveRole(prisma, tenantId, superAdmin.id, system.superAdminRoleId, 'HOSPITAL', [
    mainBranchId,
  ]);
  const admin = await upsertUser(
    prisma,
    tenantId,
    'AD001',
    `${slugOf(hospital.admin)}@${domain}`,
    hospital.admin,
    adminPassword,
  );
  await giveRole(
    prisma,
    tenantId,
    admin.id,
    system.branchAdminRoleId,
    'BRANCH',
    Object.values(branchIds),
  );

  // the working roles come from the ready-made role templates of the Roles screen
  const roleIds: Record<string, string> = {};
  for (const template of ROLE_TEMPLATES) {
    const role = await prisma.role.upsert({
      where: { tenantId_code: { tenantId, code: template.key } },
      create: {
        tenantId,
        code: template.key,
        name: template.name,
        description: template.description,
        isSystem: false,
      },
      update: { name: template.name, isActive: true },
    });
    roleIds[template.key] = role.id;
    for (const code of template.permissions) {
      const permission = await prisma.permission.findUnique({ where: { code } });
      if (permission) {
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
    }
  }
  const receptionists: Person[] = [];
  for (const [index, name] of hospital.receptionists.entries()) {
    const person = await upsertUser(
      prisma,
      tenantId,
      `RC${String(index + 1).padStart(3, '0')}`,
      `${slugOf(name)}@${domain}`,
      name,
      staffPassword,
    );
    await giveRole(prisma, tenantId, person.id, roleIds.RECEPTIONIST!, 'BRANCH', [mainBranchId]);
    receptionists.push(person);
  }
  const nurses: Person[] = [];
  for (const [index, name] of hospital.nurses.entries()) {
    const person = await upsertUser(
      prisma,
      tenantId,
      `NU${String(index + 1).padStart(3, '0')}`,
      `${slugOf(name)}@${domain}`,
      name,
      staffPassword,
    );
    await giveRole(prisma, tenantId, person.id, roleIds.NURSE!, 'BRANCH', [mainBranchId]);
    nurses.push(person);
  }

  // the starter masters (payment modes, vitals fields, number series, OPD rules, registration item)
  await runHospitalStarter(prisma, { ...defaultStarterOptions(hospital.code), dryRun: false });
  // the registration fee and the test prices
  const registration = await prisma.chargeItem.findUniqueOrThrow({
    where: { tenantId_code: { tenantId, code: 'REG' } },
  });
  await prisma.chargeItemPrice.upsert({
    where: {
      tenantId_chargeItemId_effectiveFrom: {
        tenantId,
        chargeItemId: registration.id,
        effectiveFrom: PRICE_FROM,
      },
    },
    create: {
      tenantId,
      chargeItemId: registration.id,
      amountPaise: 10_000,
      effectiveFrom: PRICE_FROM,
      createdBy: superAdmin.id,
    },
    update: {},
  });
  for (const test of TESTS) {
    const item = await prisma.chargeItem.upsert({
      where: { tenantId_code: { tenantId, code: test.code } },
      create: { tenantId, code: test.code, name: test.name, kind: 'INVESTIGATION' },
      update: { name: test.name, active: true },
    });
    await prisma.chargeItemPrice.upsert({
      where: {
        tenantId_chargeItemId_effectiveFrom: {
          tenantId,
          chargeItemId: item.id,
          effectiveFrom: PRICE_FROM,
        },
      },
      create: {
        tenantId,
        chargeItemId: item.id,
        amountPaise: test.price * 100,
        effectiveFrom: PRICE_FROM,
        createdBy: superAdmin.id,
      },
      update: {},
    });
  }
  const medicineIds: string[] = [];
  for (const medicine of MEDICINES) {
    const saved = await prisma.medicine.upsert({
      where: { tenantId_code: { tenantId, code: medicine.code } },
      create: { tenantId, ...medicine },
      update: {
        name: medicine.name,
        composition: medicine.composition,
        form: medicine.form,
        active: true,
      },
    });
    medicineIds.push(saved.id);
  }
  // doctors with specialities, registration numbers and fees
  const doctors: Setup['doctors'] = [];
  for (const [index, doctor] of hospital.doctors.entries()) {
    const code = `DR${String(index + 1).padStart(3, '0')}`;
    const person = await upsertUser(
      prisma,
      tenantId,
      code,
      `${slugOf(doctor.name)}@${domain}`,
      doctor.name,
      staffPassword,
    );
    await giveRole(prisma, tenantId, person.id, roleIds.DOCTOR!, 'BRANCH', [mainBranchId]);
    const profile = await prisma.doctorProfile.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: {
        tenantId,
        userId: person.id,
        code,
        department: doctor.department,
        printedName: doctor.name,
        qualifications: doctor.qualifications,
        speciality: doctor.speciality,
        registrationNo: `KMC/${2005 + index * 2}/${40000 + index * 1371}`,
        availabilityOn: true,
        active: true,
      },
      update: { department: doctor.department, availabilityOn: true, active: true },
    });
    for (const [visitType, rupees] of [
      ['NEW', doctor.newFee],
      ['FOLLOW_UP', doctor.followUpFee],
    ] as const) {
      const existing = await prisma.doctorFee.findFirst({
        where: {
          tenantId,
          doctorProfileId: profile.id,
          visitType,
          branchId: null,
          effectiveFrom: PRICE_FROM,
        },
      });
      if (!existing) {
        await prisma.doctorFee.create({
          data: {
            tenantId,
            doctorProfileId: profile.id,
            visitType,
            amountPaise: rupees * 100,
            effectiveFrom: PRICE_FROM,
            createdBy: superAdmin.id,
          },
        });
      }
    }
    doctors.push({
      ...person,
      profileId: profile.id,
      name: doctor.name,
      speciality: doctor.speciality,
    });
  }
  return {
    hospital,
    tenantId,
    mainBranchId,
    superAdmin,
    admin,
    receptionists,
    nurses,
    doctors,
    medicineIds,
  };
}

// ------------------------------------------------------------------------------------ history

async function makeHistory(
  app: INestApplication,
  clock: FakeClock,
  tokens: {
    signHospitalAccess: (c: { tenantId: string; userId: string; branchId: string }) => string;
  },
  prisma: PrismaClient,
  s: Setup,
  options: ShowcaseOptions,
  seed: number,
): Promise<{ visits: number; refunds: number }> {
  const rand = rng(seed);
  const token = (p: Person) =>
    tokens.signHospitalAccess({ tenantId: s.tenantId, userId: p.id, branchId: s.mainBranchId });
  const recv = s.receptionists.map(token);
  const nurse = s.nurses.map(token);
  const adminToken = token(s.admin);
  const doctorTokens = new Map(s.doctors.map((d) => [d.profileId, token(d)]));
  const http = () => request(app.getHttpServer());
  const call = (method: 'get' | 'post' | 'put', url: string, bearer: string, body?: object) => {
    const r = http()[method](url).set('Authorization', `Bearer ${bearer}`);
    return body ? r.send(body) : r;
  };

  const patients: Array<{ id: string; lastDoctor?: string; lastDay?: number }> = [];
  const usedPhones = new Set<string>();
  const newPatientBody = () => {
    const female = rand() < 0.5;
    const first = pick(rand, female ? FIRST_NAMES_F : FIRST_NAMES_M);
    const last = pick(rand, LAST_NAMES);
    const city = pick(rand, CITIES);
    let phone = '';
    do {
      phone = `${pick(rand, ['9', '8', '7', '6'])}${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    const age = Math.floor(rand() * rand() * 85) + (rand() < 0.15 ? 0 : 3);
    const dob = new Date(
      Date.now() - age * 365.25 * 86400_000 - Math.floor(rand() * 300) * 86400_000,
    );
    return {
      name: `${first} ${last}`,
      gender: female ? 'F' : 'M',
      dateOfBirth: dob.toISOString().slice(0, 10),
      phone,
      addressStreet: `${1 + Math.floor(rand() * 120)}, ${pick(rand, city.areas)} Main Road`,
      addressArea: pick(rand, city.areas),
      addressCity: city.city,
      addressState: city.state,
      addressPincode: city.pin,
    };
  };

  let visits = 0;
  let refunds = 0;
  const IST_OFFSET_MS = 5.5 * 3600_000;
  const todayIst = new Date(Date.now() + IST_OFFSET_MS);
  todayIst.setUTCHours(0, 0, 0, 0);

  for (let back = options.historyDays; back >= 0; back -= 1) {
    const dayStartUtc = todayIst.getTime() - back * 86400_000 - IST_OFFSET_MS;
    const weekday = new Date(dayStartUtc + IST_OFFSET_MS).getUTCDay();
    const growth = 1 + (options.historyDays - back) / (options.historyDays * 2.5);
    const base =
      weekday === 0
        ? options.visitsPerDay * 0.25
        : weekday === 6
          ? options.visitsPerDay * 0.8
          : options.visitsPerDay;
    let count = Math.max(2, Math.round(base * growth * (0.8 + rand() * 0.4)));
    const isToday = back === 0;
    if (isToday) {
      count = Math.min(count, 9);
    }
    for (let n = 0; n < count; n += 1) {
      // working hours 9:00 to 17:30 IST, one visit about every 12 minutes
      const minute = 9 * 60 + Math.floor((n / count) * 510);
      clock.set(new Date(dayStartUtc + minute * 60_000));
      if (isToday && clock.now().getTime() > Date.now()) {
        break;
      }
      const reception = pick(rand, recv);
      let patient: (typeof patients)[number];
      if (patients.length < 25 || rand() < 0.55) {
        const created = await call('post', '/patients', reception, newPatientBody());
        if (created.status !== 201 && created.status !== 200) {
          throw new Error(
            `patient register failed ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`,
          );
        }
        patient = { id: created.body.id as string };
        patients.push(patient);
      } else {
        patient = pick(rand, patients);
      }
      const doctor =
        rand() < 0.35 && patient.lastDoctor
          ? s.doctors.find((d) => d.profileId === patient.lastDoctor)!
          : pick(rand, s.doctors);
      const followUp =
        patient.lastDoctor === doctor.profileId &&
        patient.lastDay !== undefined &&
        back < patient.lastDay;
      const choice = {
        patientId: patient.id,
        doctorProfileId: doctor.profileId,
        visitType: followUp ? 'FOLLOW_UP' : 'NEW',
      };
      const preview = await call('post', '/opd/visits/preview', reception, choice);
      if (preview.status !== 200 && preview.status !== 201) {
        throw new Error(
          `preview failed ${preview.status} ${JSON.stringify(preview.body).slice(0, 200)}`,
        );
      }
      const total = preview.body.totalPaise as number;
      const modeRoll = rand();
      const mode = modeRoll < 0.68 ? 'CASH' : modeRoll < 0.9 ? 'UPI' : 'CARD';
      const created = await call('post', '/opd/visits', reception, {
        ...choice,
        idempotencyKey: `SHOW-${s.hospital.code}-${back}-${n}-${Math.floor(rand() * 1e6)}`,
        expectedTotalPaise: total,
        ...(rand() < 0.6 ? { receptionSymptoms: pick(rand, SYMPTOMS) } : {}),
        ...(total > 0
          ? {
              payments: [
                {
                  paymentModeCode: mode,
                  amountPaise: total,
                  ...(mode === 'CASH'
                    ? {}
                    : { referenceNo: `${mode}${Math.floor(rand() * 9e9) + 1e9}` }),
                },
              ],
            }
          : {}),
      });
      if (created.status !== 201 && created.status !== 200) {
        throw new Error(
          `visit failed ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`,
        );
      }
      visits += 1;
      patient.lastDoctor = doctor.profileId;
      patient.lastDay = back - 7;
      const visitId = created.body.id as string;
      const billId = created.body.bill?.id as string | undefined;
      // some of today's patients are still waiting: no vitals, no consultation
      if (isToday && rand() < 0.45) {
        continue;
      }
      clock.set(new Date(clock.now().getTime() + 5 * 60_000));
      const vitals = await call('post', `/opd/visits/${visitId}/vitals`, pick(rand, nurse), {
        readings: [
          { fieldCode: 'pulse', value: 64 + Math.floor(rand() * 40) },
          { fieldCode: 'temperature', value: Math.round((97.2 + rand() * 3.2) * 10) / 10 },
          { fieldCode: 'bp_systolic', value: 105 + Math.floor(rand() * 45) },
          { fieldCode: 'bp_diastolic', value: 65 + Math.floor(rand() * 30) },
          { fieldCode: 'spo2', value: 95 + Math.floor(rand() * 5) },
          { fieldCode: 'weight', value: 40 + Math.floor(rand() * 50) },
        ],
      });
      if (vitals.status !== 201 && vitals.status !== 200) {
        throw new Error(
          `vitals failed ${vitals.status} ${JSON.stringify(vitals.body).slice(0, 200)}`,
        );
      }
      if (isToday && rand() < 0.3) {
        continue;
      }
      clock.set(new Date(clock.now().getTime() + 8 * 60_000));
      const doctorToken = doctorTokens.get(doctor.profileId)!;
      const started = await call('post', `/opd/visits/${visitId}/start`, doctorToken);
      if (started.status !== 201 && started.status !== 200) {
        throw new Error(
          `start failed ${started.status} ${JSON.stringify(started.body).slice(0, 200)}`,
        );
      }
      await call('put', `/opd/visits/${visitId}/consultation`, doctorToken, {
        complaints: pick(rand, SYMPTOMS),
        diagnosis: pick(rand, DIAGNOSES),
        advice: pick(rand, ADVICE),
      });
      const items = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
        medicineId: pick(rand, s.medicineIds),
        dose: pick(rand, DOSES),
        frequency: pick(rand, FREQUENCIES),
        duration: pick(rand, DURATIONS),
      }));
      // a medicine only once per prescription
      const unique = items.filter(
        (item, index) => items.findIndex((x) => x.medicineId === item.medicineId) === index,
      );
      await call('put', `/opd/visits/${visitId}/prescription`, doctorToken, { items: unique });
      clock.set(new Date(clock.now().getTime() + 6 * 60_000));
      const done = await call('post', `/opd/visits/${visitId}/complete`, doctorToken);
      if (done.status !== 201 && done.status !== 200) {
        throw new Error(
          `complete failed ${done.status} ${JSON.stringify(done.body).slice(0, 200)}`,
        );
      }
      // a few refunds, decided by the Admin
      if (billId && total > 0 && !isToday && rand() < 0.03) {
        clock.set(new Date(clock.now().getTime() + 30 * 60_000));
        const asked = await call('post', `/opd/bills/${billId}/refund-requests`, reception, {
          amountPaise: Math.min(total, 10_000),
          reason: 'Charged for a service not taken',
          idempotencyKey: `SHOWRF-${s.hospital.code}-${back}-${n}-${Math.floor(rand() * 1e6)}`,
        });
        if (asked.status === 201) {
          const decided = await call(
            'post',
            `/opd/refund-requests/${asked.body.request.id}/approve`,
            adminToken,
            {},
          );
          if (decided.status === 200 || decided.status === 201) {
            refunds += 1;
          }
        }
      }
    }
  }
  return { visits, refunds };
}

export async function seedShowcase(prisma: PrismaClient, options: ShowcaseOptions): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The showcase seed runs only with NODE_ENV=development');
  }
  const setups: Setup[] = [];
  for (const hospital of SHOWCASE_HOSPITALS) {
    setups.push(await setupHospital(prisma, hospital));
    console.log(`Showcase hospital ready: ${hospital.name}`);
  }
  const library = await seedLibrary(prisma, setups);
  const clock = new FakeClock(new Date());
  const { AppModule } = await import('../../app.module');
  const { TokenService } = await import('../../modules/auth/token.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  try {
    const tokens = app.get(TokenService);
    await chooseDesigns(app, tokens, setups, library);
    for (const [index, setup] of setups.entries()) {
      const existing = await prisma.opdVisit.count({ where: { tenantId: setup.tenantId } });
      if (existing > 0) {
        console.log(`${setup.hospital.name}: already has ${existing} visits, history skipped.`);
        continue;
      }
      const made = await makeHistory(app, clock, tokens, prisma, setup, options, 1000 + index);
      console.log(`${setup.hospital.name}: ${made.visits} visits, ${made.refunds} refunds.`);
    }
  } finally {
    await app.close();
  }
}

export { SYSTEM_ROLE_CODES };
