import { randomUUID } from 'crypto';
import type { PrismaClient } from '../../src/generated/prisma';
import { SystemClock } from '../../src/common/clock';
import { runWithContext } from '../../src/common/request-context';
import { assertDevTenantSeedAllowed } from '../../src/config/production-seed-guard';
import { TenantDb } from '../../src/database/tenant-db';
import { PrismaService } from '../../src/database/prisma.service';
import { UhidService } from '../../src/modules/patients/uhid.service';
import { normalizePhoneIN } from '../../src/common/phone.normalize';
import {
  DEV_SEED_AREAS,
  DEV_SEED_CITIES,
  DEV_SEED_CREATED_AT_DAYS,
  DEV_SEED_FIRST_NAMES,
  DEV_SEED_GENDERS,
  DEV_SEED_LAST_NAMES,
  DEV_SEED_PATIENT_TARGET,
  DEV_SEED_STATES,
} from './dev-patient-names';

const DEMO_HOSPITAL_CODES = ['DEMO_NORTH', 'DEMO_SOUTH'] as const;

/**
 * Dev-only fake patients for DEMO_* hospitals.
 * Uses UhidService.allocateNextUhid under HOSPITAL request context + TenantDb
 * (actor = hospital SuperAdmin). Idempotent: skip when tenant already has
 * >= DEV_SEED_PATIENT_TARGET patients (counts Postman/manual rows too).
 */
export async function seedDevPatients(prisma: PrismaClient): Promise<void> {
  assertDevTenantSeedAllowed(process.env.NODE_ENV);

  const tenantDb = new TenantDb(prisma as unknown as PrismaService);
  const uhid = new UhidService(tenantDb, new SystemClock());

  for (const code of DEMO_HOSPITAL_CODES) {
    const hospital = await prisma.hospital.findUnique({
      where: { code },
      include: { branches: true },
    });
    if (!hospital || !hospital.isTest) {
      continue;
    }
    const existing = await prisma.patient.count({ where: { tenantId: hospital.id } });
    if (existing >= DEV_SEED_PATIENT_TARGET) {
      console.log(
        `Skipping patient seed for ${code}: already has ${existing} (>= ${DEV_SEED_PATIENT_TARGET}).`,
      );
      continue;
    }

    const actor = await prisma.user.findFirst({
      where: { tenantId: hospital.id, code: 'SA001', isActive: true },
    });
    if (!actor) {
      throw new Error(`Dev patient seed: SuperAdmin SA001 missing for ${code}`);
    }
    const branches = hospital.branches.filter((b) => b.isActive);
    if (branches.length === 0) {
      throw new Error(`Dev patient seed: no branches for ${code}`);
    }

    const customFields =
      code === 'DEMO_NORTH'
        ? await prisma.patientCustomField.findMany({
            where: { tenantId: hospital.id, isActive: true },
            include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
          })
        : [];

    const toCreate = DEV_SEED_PATIENT_TARGET - existing;
    const phoneBase = code === 'DEMO_NORTH' ? 7_000_000_000 : 7_100_000_000;

    for (let i = 0; i < toCreate; i++) {
      const index = existing + i;
      const first = DEV_SEED_FIRST_NAMES[index % DEV_SEED_FIRST_NAMES.length]!;
      const last = DEV_SEED_LAST_NAMES[index % DEV_SEED_LAST_NAMES.length]!;
      // A few duplicate names for duplicate-flow demos.
      const name =
        index % 17 === 0 || index % 17 === 1 ? 'Seed Twin SameName' : `Seed ${first} ${last}`;
      const gender = DEV_SEED_GENDERS[index % DEV_SEED_GENDERS.length]!;
      const ageYears = 1 + (index % 90);
      const useExactDob = index % 3 !== 0;
      const dateOfBirth = useExactDob
        ? new Date(Date.UTC(2026 - ageYears, index % 12, 1 + (index % 27)))
        : estimatedDob(ageYears);
      const dobIsEstimated = !useExactDob;
      const national = String(phoneBase + index).padStart(10, '0');
      const phone = normalizePhoneIN(national);
      const branch = branches[index % branches.length]!;
      const createdAt = daysAgo(index % DEV_SEED_CREATED_AT_DAYS);

      const fillAddress = index % 5 !== 4;
      const addressArea = fillAddress ? DEV_SEED_AREAS[index % DEV_SEED_AREAS.length]! : null;
      const addressCity = fillAddress ? DEV_SEED_CITIES[index % DEV_SEED_CITIES.length]! : null;
      const addressState = fillAddress ? DEV_SEED_STATES[index % DEV_SEED_STATES.length]! : null;
      const addressPincode = fillAddress ? String(560001 + (index % 90)).padStart(6, '0') : null;

      await runWithContext(
        {
          tenantId: hospital.id,
          userId: actor.id,
          kind: 'HOSPITAL',
          activeBranchId: branch.id,
          requestId: randomUUID(),
        },
        async () => {
          await tenantDb.withTenant(async (tx) => {
            const { uhid: nextUhid } = await uhid.allocateNextUhid({
              tenantId: hospital.id,
              branchId: branch.id,
              tx,
            });
            const patient = await tx.patient.create({
              data: {
                tenantId: hospital.id,
                uhid: nextUhid,
                registeredBranchId: branch.id,
                name,
                gender,
                dateOfBirth,
                dobIsEstimated,
                phone,
                addressArea,
                addressCity,
                addressState,
                addressPincode,
                createdBy: actor.id,
                createdAt,
                updatedAt: createdAt,
              },
            });

            if (code === 'DEMO_NORTH' && index % 4 === 0 && customFields.length > 0) {
              for (const field of customFields.slice(0, 3)) {
                if (field.dataType === 'DROPDOWN' && field.options[0]) {
                  await tx.patientCustomFieldValue.create({
                    data: {
                      tenantId: hospital.id,
                      patientId: patient.id,
                      fieldId: field.id,
                      optionId: field.options[0].id,
                    },
                  });
                } else if (field.dataType === 'TEXT') {
                  await tx.patientCustomFieldValue.create({
                    data: {
                      tenantId: hospital.id,
                      patientId: patient.id,
                      fieldId: field.id,
                      valueText: 'Seed Relative',
                    },
                  });
                }
              }
            }
          });
        },
      );
    }

    console.log(
      `Seeded ${toCreate} fake patients for ${code} (target ${DEV_SEED_PATIENT_TARGET}).`,
    );
  }
}

function estimatedDob(ageYears: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - ageYears, now.getUTCMonth(), now.getUTCDate()));
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(10, 0, 0, 0);
  return d;
}
