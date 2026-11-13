import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma } from '../../database/db-test.util';
import { rebuildHospigoTest } from '../../../scripts/rebuild-hospigo-test';
import { seedDevTenants } from '../../../prisma/seeds/dev-tenants';
import { seedReferenceData } from '../../../prisma/seeds/reference';

loadEnv({ path: path.resolve(__dirname, '../../../../../.env') });

const EXPECTED = {
  DEMO_NORTH: { doctors: 5, receptionists: 2, nurses: 2 },
  DEMO_SOUTH: { doctors: 3, receptionists: 2, nurses: 2 },
  investigations: 80,
  medicines: 300,
  vitals: 7,
  paymentModes: 3,
  series: 3,
} as const;

describe('OPD masters mock seed (idempotent)', () => {
  const owner = createOwnerPrisma();
  let previousNodeEnv: string | undefined;

  beforeAll(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    await seedReferenceData(owner);
    await seedDevTenants(owner);
    await seedDevTenants(owner);
  }, 120_000);

  afterAll(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await owner.$disconnect();
    // Leave hospigo_test as globalSetup left it: migrations + reference seed only.
    await rebuildHospigoTest();
    const check = createOwnerPrisma();
    try {
      expect(await check.hospital.count()).toBe(0);
      expect(await check.permission.count({ where: { isActive: true } })).toBeGreaterThan(0);
      expect(await check.module.count({ where: { isActive: true } })).toBeGreaterThan(0);
    } finally {
      await check.$disconnect();
    }
  }, 120_000);

  async function countsFor(code: 'DEMO_NORTH' | 'DEMO_SOUTH') {
    const hospital = await owner.hospital.findUniqueOrThrow({ where: { code } });
    const tenantId = hospital.id;
    const doctors = await owner.doctorProfile.count({ where: { tenantId, active: true } });
    const receptionists = await owner.user.count({
      where: { tenantId, code: { startsWith: 'RC' } },
    });
    const nurses = await owner.user.count({
      where: { tenantId, code: { startsWith: 'NU' } },
    });
    const registration = await owner.chargeItem.count({
      where: { tenantId, kind: 'REGISTRATION' },
    });
    const investigations = await owner.chargeItem.count({
      where: { tenantId, kind: 'INVESTIGATION' },
    });
    const medicines = await owner.medicine.count({ where: { tenantId } });
    const vitals = await owner.vitalsField.count({ where: { tenantId } });
    const paymentModes = await owner.paymentMode.count({ where: { tenantId } });
    const settings = await owner.opdSettings.count({ where: { tenantId } });
    const series = await owner.numberSeriesSettings.count({ where: { tenantId } });
    const prices = await owner.chargeItemPrice.count({ where: { tenantId } });
    const fees = await owner.doctorFee.count({ where: { tenantId } });
    return {
      doctors,
      receptionists,
      nurses,
      registration,
      investigations,
      medicines,
      vitals,
      paymentModes,
      settings,
      series,
      prices,
      fees,
    };
  }

  it('keeps stable counts after seeding twice', async () => {
    for (const code of ['DEMO_NORTH', 'DEMO_SOUTH'] as const) {
      const c = await countsFor(code);
      expect(c.doctors).toBe(EXPECTED[code].doctors);
      expect(c.receptionists).toBe(EXPECTED[code].receptionists);
      expect(c.nurses).toBe(EXPECTED[code].nurses);
      expect(c.registration).toBe(1);
      expect(c.investigations).toBe(EXPECTED.investigations);
      expect(c.medicines).toBe(EXPECTED.medicines);
      expect(c.vitals).toBe(EXPECTED.vitals);
      expect(c.paymentModes).toBe(EXPECTED.paymentModes);
      expect(c.settings).toBe(1);
      expect(c.series).toBe(EXPECTED.series);
      expect(c.prices).toBe(1 + EXPECTED.investigations);
      expect(c.fees).toBe(EXPECTED[code].doctors * 2);
    }

    const north = await owner.hospital.findUniqueOrThrow({ where: { code: 'DEMO_NORTH' } });
    const south = await owner.hospital.findUniqueOrThrow({ where: { code: 'DEMO_SOUTH' } });
    const northOff = await owner.doctorProfile.count({
      where: { tenantId: north.id, availabilityOn: false },
    });
    expect(northOff).toBe(1);
    const southLeave = await owner.doctorLeave.count({ where: { tenantId: south.id } });
    expect(southLeave).toBeGreaterThanOrEqual(1);
    const northTimings = await owner.doctorTiming.count({ where: { tenantId: north.id } });
    expect(northTimings).toBe(EXPECTED.DEMO_NORTH.doctors * 5);
  });
});
