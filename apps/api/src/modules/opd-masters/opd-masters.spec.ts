import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { AccessService } from '../access/access.service';
import { runWithContext } from '../../common/request-context';
import {
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  createTenantDb,
  hospitalContext,
  withTenant,
} from '../../database/db-test.util';
import { assertDevTenantSeedAllowed } from '../../config/production-seed-guard';
import { DoctorAvailabilityService } from './doctor-availability.service';
import { renderNumberSeriesFormat, validateNumberSeriesFormat } from './number-series-format';
import { OpdSettingsService } from './opd-settings.service';
import { PriceService } from './price.service';
import { OPD_SETTINGS_DEFAULTS } from './opd-settings.defaults';

loadEnv({ path: path.resolve(__dirname, '../../../../../.env') });

const OPD_TABLES = [
  'doctor_profiles',
  'doctor_timings',
  'doctor_leave',
  'charge_items',
  'charge_item_prices',
  'doctor_fees',
  'medicines',
  'vitals_fields',
  'payment_modes',
  'opd_settings',
  'number_series_settings',
] as const;

const PRICE_TABLES = ['charge_item_prices', 'doctor_fees'] as const;

function patientUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_PATIENT;
  if (!raw) {
    throw new Error('DATABASE_URL_PATIENT required');
  }
  const parsed = new URL(raw);
  parsed.pathname = '/hospigo_test';
  return parsed.toString();
}

describe('OPD masters (Phase 2 Step 2)', () => {
  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchB: string;
  let userA: string;
  let userB: string;
  let doctorA: string;
  let doctorB: string;
  let chargeA: string;
  let chargeB: string;
  let priceA: string;
  let feeA: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const ha = await owner.hospital.create({
      data: {
        code: `OPD_A_${stamp}`,
        name: 'OPD Isolation A',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `opd-a-${stamp}` },
        },
      },
      include: { branches: true },
    });
    const hb = await owner.hospital.create({
      data: {
        code: `OPD_B_${stamp}`,
        name: 'OPD Isolation B',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `opd-b-${stamp}` },
        },
      },
      include: { branches: true },
    });
    tenantA = ha.id;
    tenantB = hb.id;
    branchA = ha.branches[0]!.id;
    branchB = hb.branches[0]!.id;

    const ua = await owner.user.create({
      data: {
        tenantId: tenantA,
        code: `UA_${stamp}`,
        email: `ua_${stamp}@example.test`,
        displayName: 'User A',
        passwordHash: 'x',
      },
    });
    const ub = await owner.user.create({
      data: {
        tenantId: tenantB,
        code: `UB_${stamp}`,
        email: `ub_${stamp}@example.test`,
        displayName: 'User B',
        passwordHash: 'x',
      },
    });
    userA = ua.id;
    userB = ub.id;

    const da = await owner.doctorProfile.create({
      data: { tenantId: tenantA, userId: userA, code: 'DR001', availabilityOn: true },
    });
    const db = await owner.doctorProfile.create({
      data: { tenantId: tenantB, userId: userB, code: 'DR001', availabilityOn: true },
    });
    doctorA = da.id;
    doctorB = db.id;

    const ca = await owner.chargeItem.create({
      data: {
        tenantId: tenantA,
        code: 'REG',
        name: 'Registration',
        kind: 'REGISTRATION',
      },
    });
    const cb = await owner.chargeItem.create({
      data: {
        tenantId: tenantB,
        code: 'REG',
        name: 'Registration',
        kind: 'REGISTRATION',
      },
    });
    chargeA = ca.id;
    chargeB = cb.id;

    const pa = await owner.chargeItemPrice.create({
      data: {
        tenantId: tenantA,
        chargeItemId: chargeA,
        amountPaise: 1000,
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdBy: userA,
      },
    });
    priceA = pa.id;
    await owner.chargeItemPrice.create({
      data: {
        tenantId: tenantB,
        chargeItemId: chargeB,
        amountPaise: 2000,
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdBy: userB,
      },
    });

    const fa = await owner.doctorFee.create({
      data: {
        tenantId: tenantA,
        doctorProfileId: doctorA,
        visitType: 'NEW',
        amountPaise: 5000,
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdBy: userA,
      },
    });
    feeA = fa.id;
    await owner.doctorFee.create({
      data: {
        tenantId: tenantB,
        doctorProfileId: doctorB,
        visitType: 'NEW',
        amountPaise: 6000,
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdBy: userB,
      },
    });

    await owner.medicine.create({
      data: { tenantId: tenantA, code: 'MED1', name: 'Med A' },
    });
    await owner.medicine.create({
      data: { tenantId: tenantB, code: 'MED1', name: 'Med B' },
    });
    await owner.vitalsField.create({
      data: {
        tenantId: tenantA,
        code: 'pulse',
        name: 'Pulse',
        unit: 'bpm',
        valueKind: 'NUMBER',
        displayOrder: 1,
      },
    });
    await owner.vitalsField.create({
      data: {
        tenantId: tenantB,
        code: 'pulse',
        name: 'Pulse',
        unit: 'bpm',
        valueKind: 'NUMBER',
        displayOrder: 1,
      },
    });
    await owner.paymentMode.create({
      data: {
        tenantId: tenantA,
        code: 'CASH',
        name: 'Cash',
        requiresReference: false,
      },
    });
    await owner.paymentMode.create({
      data: {
        tenantId: tenantB,
        code: 'CASH',
        name: 'Cash',
        requiresReference: false,
      },
    });
    await owner.opdSettings.create({ data: { tenantId: tenantA } });
    await owner.opdSettings.create({ data: { tenantId: tenantB } });
    await owner.numberSeriesSettings.create({
      data: {
        tenantId: tenantA,
        series: 'BILL',
        format: [
          { type: 'FINANCIAL_YEAR', style: 'SHORT' },
          { type: 'SEPARATOR', text: '/' },
          { type: 'RUNNING', width: 5 },
        ],
        resetRule: 'FINANCIAL_YEAR',
      },
    });
    await owner.numberSeriesSettings.create({
      data: {
        tenantId: tenantB,
        series: 'BILL',
        format: [
          { type: 'FINANCIAL_YEAR', style: 'SHORT' },
          { type: 'SEPARATOR', text: '/' },
          { type: 'RUNNING', width: 5 },
        ],
        resetRule: 'FINANCIAL_YEAR',
      },
    });
    await owner.doctorTiming.create({
      data: {
        tenantId: tenantA,
        doctorProfileId: doctorA,
        branchId: branchA,
        weekday: 1,
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
      },
    });
    await owner.doctorTiming.create({
      data: {
        tenantId: tenantB,
        doctorProfileId: doctorB,
        branchId: branchB,
        weekday: 1,
        startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
      },
    });
    await owner.doctorLeave.create({
      data: {
        tenantId: tenantA,
        doctorProfileId: doctorA,
        fromDate: new Date('2031-01-01T00:00:00.000Z'),
        toDate: new Date('2031-01-01T00:00:00.000Z'),
      },
    });
    await owner.doctorLeave.create({
      data: {
        tenantId: tenantB,
        doctorProfileId: doctorB,
        fromDate: new Date('2031-01-01T00:00:00.000Z'),
        toDate: new Date('2031-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  describe('isolation', () => {
    it('tenant A cannot read or write tenant B rows; unset tenant sees nothing', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        for (const table of OPD_TABLES) {
          const asA = await withTenant(client, tenantA, async () => {
            const r = await client.query(`SELECT id FROM ${table} WHERE tenant_id = $1`, [tenantB]);
            return r.rowCount ?? 0;
          });
          expect({ table, asA }).toEqual({ table, asA: 0 });

          const unset = await withTenant(client, null, async () => {
            const r = await client.query(`SELECT id FROM ${table}`);
            return r.rowCount ?? 0;
          });
          expect({ table, unset }).toEqual({ table, unset: 0 });
        }

        await withTenant(client, tenantA, async () => {
          await expect(
            client.query(`UPDATE medicines SET name = name WHERE tenant_id = $1 RETURNING id`, [
              tenantB,
            ]),
          ).resolves.toMatchObject({ rowCount: 0 });
        });
      } finally {
        await client.end();
      }
    });

    it('hq and patient logins are denied on OPD tables', async () => {
      const hq = createPgClient('hq');
      await hq.connect();
      try {
        for (const table of OPD_TABLES) {
          await expect(hq.query(`SELECT 1 FROM ${table}`)).rejects.toThrow();
        }
      } finally {
        await hq.end();
      }

      const patient = new Client({
        connectionString: patientUrlOnTestDb(),
        connectionTimeoutMillis: 5000,
      });
      await patient.connect();
      try {
        for (const table of OPD_TABLES) {
          await expect(patient.query(`SELECT 1 FROM ${table}`)).rejects.toThrow();
        }
      } finally {
        await patient.end();
      }
    });

    it('composite FK cannot point at another tenant parent', async () => {
      await expect(
        owner.doctorTiming.create({
          data: {
            tenantId: tenantA,
            doctorProfileId: doctorB,
            branchId: branchA,
            weekday: 2,
            startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
            endTime: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.chargeItemPrice.create({
          data: {
            tenantId: tenantA,
            chargeItemId: chargeB,
            amountPaise: 1,
            effectiveFrom: new Date('2021-01-01T00:00:00.000Z'),
            createdBy: userA,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('privileges', () => {
    it('hospigo_app cannot DELETE on any of the 11 tables', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        for (const table of OPD_TABLES) {
          const res = await client.query<{ ok: boolean }>(
            `SELECT has_table_privilege('hospigo_app', $1, 'DELETE') AS ok`,
            [`public.${table}`],
          );
          expect({ table, delete: res.rows[0]?.ok }).toEqual({ table, delete: false });
        }
      } finally {
        await client.end();
      }
    });

    it('UPDATE/DELETE on price tables refused for app and owner (trigger)', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
        for (const table of PRICE_TABLES) {
          const id = table === 'charge_item_prices' ? priceA : feeA;
          await expect(
            client.query(`UPDATE ${table} SET amount_paise = amount_paise WHERE id = $1`, [id]),
          ).rejects.toThrow();
          await expect(client.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow();
        }
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }

      const ownerClient = createPgClient('owner');
      await ownerClient.connect();
      try {
        for (const table of PRICE_TABLES) {
          const id = table === 'charge_item_prices' ? priceA : feeA;
          await expect(
            ownerClient.query(`UPDATE ${table} SET amount_paise = amount_paise WHERE id = $1`, [
              id,
            ]),
          ).rejects.toThrow(/append-only/i);
          await expect(
            ownerClient.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
          ).rejects.toThrow(/append-only/i);
        }
      } finally {
        await ownerClient.end();
      }
    });

    it('TRUNCATE by owner login is refused on charge_item_prices and doctor_fees', async () => {
      const ownerClient = createPgClient('owner');
      await ownerClient.connect();
      try {
        for (const table of PRICE_TABLES) {
          await expect(ownerClient.query(`TRUNCATE ${table}`)).rejects.toThrow(
            /append-only|truncate/i,
          );
        }
      } finally {
        await ownerClient.end();
      }
    });
  });

  describe('constraints', () => {
    it('refuses negative amount, duplicate code, bad dates, weekday, tax rate, follow-up days, times, warn range', async () => {
      await expect(
        owner.chargeItemPrice.create({
          data: {
            tenantId: tenantA,
            chargeItemId: chargeA,
            amountPaise: -1,
            effectiveFrom: new Date('2022-01-01T00:00:00.000Z'),
            createdBy: userA,
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.chargeItem.create({
          data: {
            tenantId: tenantA,
            code: 'REG',
            name: 'Dup',
            kind: 'REGISTRATION',
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.doctorLeave.create({
          data: {
            tenantId: tenantA,
            doctorProfileId: doctorA,
            fromDate: new Date('2032-02-01T00:00:00.000Z'),
            toDate: new Date('2032-01-01T00:00:00.000Z'),
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.doctorTiming.create({
          data: {
            tenantId: tenantA,
            doctorProfileId: doctorA,
            branchId: branchA,
            weekday: 7,
            startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
            endTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.doctorTiming.create({
          data: {
            tenantId: tenantA,
            doctorProfileId: doctorA,
            branchId: branchA,
            weekday: 3,
            startTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
            endTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.chargeItem.create({
          data: {
            tenantId: tenantA,
            code: `BADTAX_${Date.now()}`,
            name: 'Bad tax',
            kind: 'INVESTIGATION',
            taxRateBp: 10001,
          },
        }),
      ).rejects.toThrow();

      await expect(
        owner.opdSettings.update({
          where: { tenantId: tenantA },
          data: { followUpFreeDays: 400 },
        }),
      ).rejects.toThrow();

      await expect(
        owner.vitalsField.create({
          data: {
            tenantId: tenantA,
            code: `BADWARN_${Date.now()}`,
            name: 'Bad warn',
            unit: 'u',
            valueKind: 'NUMBER',
            displayOrder: 99,
            warnMin: 10,
            warnMax: 5,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('PriceService', () => {
    let prices: PriceService;

    beforeAll(() => {
      prices = new PriceService(createTenantDb(app));
    });

    async function asTenantA<T>(fn: () => Promise<T>): Promise<T> {
      return runWithContext(hospitalContext(tenantA, { userId: userA }), fn);
    }

    it('returns latest version in force; earlier as-of unchanged; future ignored; past insert refused', async () => {
      const item = await owner.chargeItem.create({
        data: {
          tenantId: tenantA,
          code: `PRC_${Date.now()}`,
          name: 'Price probe',
          kind: 'INVESTIGATION',
        },
      });
      const t1 = new Date('2024-01-01T00:00:00.000Z');
      const t2 = new Date('2024-06-01T00:00:00.000Z');
      const tFuture = new Date('2099-01-01T00:00:00.000Z');
      const mid = new Date('2024-03-01T00:00:00.000Z');

      await asTenantA(() =>
        prices.addChargeItemPrice({
          chargeItemId: item.id,
          amountPaise: 100,
          effectiveFrom: t1,
          createdBy: userA,
        }),
      );
      await asTenantA(() =>
        prices.addChargeItemPrice({
          chargeItemId: item.id,
          amountPaise: 200,
          effectiveFrom: t2,
          createdBy: userA,
        }),
      );
      await asTenantA(() =>
        prices.addChargeItemPrice({
          chargeItemId: item.id,
          amountPaise: 300,
          effectiveFrom: tFuture,
          createdBy: userA,
        }),
      );

      const atMid = await asTenantA(() => prices.getChargeItemPrice(item.id, mid));
      expect(atMid?.amountPaise).toBe(100);

      const atNow = await asTenantA(() =>
        prices.getChargeItemPrice(item.id, new Date('2025-01-01T00:00:00.000Z')),
      );
      expect(atNow?.amountPaise).toBe(200);

      const beforeFuture = await asTenantA(() =>
        prices.getChargeItemPrice(item.id, new Date('2098-12-01T00:00:00.000Z')),
      );
      expect(beforeFuture?.amountPaise).toBe(200);

      await expect(
        asTenantA(() =>
          prices.addChargeItemPrice({
            chargeItemId: item.id,
            amountPaise: 50,
            effectiveFrom: new Date('2023-01-01T00:00:00.000Z'),
            createdBy: userA,
          }),
        ),
      ).rejects.toThrow(/earlier than the latest/i);

      const feeMid = await asTenantA(() =>
        prices.getDoctorFee(doctorA, 'NEW', new Date('2021-01-01T00:00:00.000Z')),
      );
      expect(feeMid?.amountPaise).toBe(5000);
    });
  });

  describe('DoctorAvailabilityService', () => {
    let availability: DoctorAvailabilityService;
    let profileId: string;
    let branchId: string;

    beforeAll(async () => {
      availability = new DoctorAvailabilityService(createTenantDb(app));
      const stamp = Date.now();
      const user = await owner.user.create({
        data: {
          tenantId: tenantA,
          code: `DAV_${stamp}`,
          email: `dav_${stamp}@example.test`,
          displayName: 'Avail Doc',
          passwordHash: 'x',
        },
      });
      const profile = await owner.doctorProfile.create({
        data: {
          tenantId: tenantA,
          userId: user.id,
          code: `DAV_${stamp}`,
          availabilityOn: true,
        },
      });
      profileId = profile.id;
      branchId = branchA;
      await owner.doctorTiming.create({
        data: {
          tenantId: tenantA,
          doctorProfileId: profileId,
          branchId,
          weekday: 1,
          startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          endTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
        },
      });
      await owner.opdSettings.upsert({
        where: { tenantId: tenantA },
        create: {
          tenantId: tenantA,
          timezone: OPD_SETTINGS_DEFAULTS.timezone,
        },
        update: { timezone: OPD_SETTINGS_DEFAULTS.timezone },
      });
    });

    async function asA<T>(fn: () => Promise<T>): Promise<T> {
      return runWithContext(hospitalContext(tenantA, { userId: userA }), fn);
    }

    it('switch off makes available false', async () => {
      await owner.doctorProfile.update({
        where: { id: profileId },
        data: { availabilityOn: false },
      });
      // Monday 2024-01-08 10:00 IST = 04:30 UTC
      const at = new Date('2024-01-08T04:30:00.000Z');
      const result = await asA(() => availability.getAvailability(profileId, branchId, at));
      expect(result).toEqual({
        available: false,
        reason: 'SWITCH_OFF',
        outsideTimings: false,
      });
      await owner.doctorProfile.update({
        where: { id: profileId },
        data: { availabilityOn: true },
      });
    });

    it('on leave makes available false', async () => {
      await owner.doctorLeave.create({
        data: {
          tenantId: tenantA,
          doctorProfileId: profileId,
          fromDate: new Date('2024-01-08T00:00:00.000Z'),
          toDate: new Date('2024-01-08T00:00:00.000Z'),
          reason: 'mock',
        },
      });
      const at = new Date('2024-01-08T04:30:00.000Z');
      const result = await asA(() => availability.getAvailability(profileId, branchId, at));
      expect(result.available).toBe(false);
      expect(result.reason).toBe('ON_LEAVE');
    });

    it('outside timings warn only (available stays true when not leave/switch)', async () => {
      const otherUser = await owner.user.create({
        data: {
          tenantId: tenantA,
          code: `OUT_${Date.now()}`,
          email: `out_${Date.now()}@example.test`,
          displayName: 'Outside',
          passwordHash: 'x',
        },
      });
      const other = await owner.doctorProfile.create({
        data: {
          tenantId: tenantA,
          userId: otherUser.id,
          code: `OUT_${Date.now()}`,
          availabilityOn: true,
        },
      });
      await owner.doctorTiming.create({
        data: {
          tenantId: tenantA,
          doctorProfileId: other.id,
          branchId,
          weekday: 1,
          startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          endTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
        },
      });
      // Monday 20:00 IST = 14:30 UTC
      const at = new Date('2024-01-08T14:30:00.000Z');
      const result = await asA(() => availability.getAvailability(other.id, branchId, at));
      expect(result).toEqual({
        available: true,
        reason: null,
        outsideTimings: true,
      });
    });

    it('IST day boundary: late UTC evening is already next day in IST', async () => {
      // 2024-01-07 20:00 UTC = 2024-01-08 01:30 IST (Monday) — still outside Mon 09–17
      const at = new Date('2024-01-07T20:00:00.000Z');
      const otherUser = await owner.user.create({
        data: {
          tenantId: tenantA,
          code: `IST_${Date.now()}`,
          email: `ist_${Date.now()}@example.test`,
          displayName: 'Ist',
          passwordHash: 'x',
        },
      });
      const other = await owner.doctorProfile.create({
        data: {
          tenantId: tenantA,
          userId: otherUser.id,
          code: `IST_${Date.now()}`,
          availabilityOn: true,
        },
      });
      await owner.doctorTiming.create({
        data: {
          tenantId: tenantA,
          doctorProfileId: other.id,
          branchId,
          weekday: 1,
          startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          endTime: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
        },
      });
      const result = await asA(() => availability.getAvailability(other.id, branchId, at));
      expect(result.outsideTimings).toBe(true);
      // Confirm weekday crossed: Sunday evening UTC → Monday IST
      expect(result.available).toBe(true);
    });
  });

  describe('OpdSettingsService and number-series format', () => {
    it('returns defaults without writing; validates upsert', async () => {
      const stamp = Date.now();
      const h = await owner.hospital.create({
        data: {
          code: `OPD_SET_${stamp}`,
          name: 'Settings probe',
          isTest: true,
        },
      });
      const settings = new OpdSettingsService(createTenantDb(app));
      const view = await runWithContext(hospitalContext(h.id), () => settings.get());
      expect(view.persisted).toBe(false);
      expect(view.followUpFreeDays).toBe(OPD_SETTINGS_DEFAULTS.followUpFreeDays);
      expect(view.timezone).toBe(OPD_SETTINGS_DEFAULTS.timezone);
      const count = await owner.opdSettings.count({ where: { tenantId: h.id } });
      expect(count).toBe(0);

      await expect(
        runWithContext(hospitalContext(h.id), () => settings.upsert({ followUpFreeDays: 400 })),
      ).rejects.toThrow(/follow_up_free_days/);

      const saved = await runWithContext(hospitalContext(h.id), () =>
        settings.upsert({ followUpFreeDays: 14, tokenPrefix: 'X' }),
      );
      expect(saved.persisted).toBe(true);
      expect(saved.followUpFreeDays).toBe(14);
      expect(saved.tokenPrefix).toBe('X');
    });

    it('validates and renders number-series format (e.g. 2627/00001)', () => {
      const format = [
        { type: 'FINANCIAL_YEAR' as const, style: 'SHORT' as const },
        { type: 'SEPARATOR' as const, text: '/' },
        { type: 'RUNNING' as const, width: 5 },
      ];
      validateNumberSeriesFormat(format);
      expect(renderNumberSeriesFormat(format, { financialYear: 2026, running: 1n })).toBe(
        '2627/00001',
      );
      expect(() => validateNumberSeriesFormat([])).toThrow();
      expect(() => validateNumberSeriesFormat([{ type: 'FIXED', text: 'X' }])).toThrow(/RUNNING/);
    });
  });

  describe('permissions via AccessService.can', () => {
    it('Receptionist can read masters but not write prices/settings; Branch Admin can', async () => {
      const stamp = Date.now();
      const hospital = await owner.hospital.create({
        data: {
          code: `OPD_PERM_${stamp}`,
          name: 'Perm probe',
          isTest: true,
          branches: {
            create: {
              code: 'MAIN',
              name: 'Main',
              isMain: true,
              accessCode: `opd-perm-${stamp}`,
            },
          },
        },
        include: { branches: true },
      });
      const branchId = hospital.branches[0]!.id;
      const tenantId = hospital.id;

      for (const code of [
        'opd.masters.read',
        'opd.masters.write',
        'opd.prices.write',
        'opd.settings.write',
      ]) {
        await owner.permission.upsert({
          where: { code },
          create: { code, description: code },
          update: { isActive: true },
        });
      }
      const perms = await owner.permission.findMany({
        where: {
          code: {
            in: ['opd.masters.read', 'opd.masters.write', 'opd.prices.write', 'opd.settings.write'],
          },
        },
      });
      const byCode = Object.fromEntries(perms.map((p) => [p.code, p.id]));

      const receptionist = await owner.role.create({
        data: {
          tenantId,
          code: 'RECEPTIONIST',
          name: 'Receptionist',
          isSystem: false,
        },
      });
      await owner.rolePermission.create({
        data: {
          tenantId,
          roleId: receptionist.id,
          permissionId: byCode['opd.masters.read']!,
        },
      });

      const branchAdmin = await owner.role.create({
        data: {
          tenantId,
          code: 'BRANCH_ADMIN',
          name: 'Branch Admin',
          isSystem: true,
        },
      });
      for (const id of Object.values(byCode)) {
        await owner.rolePermission.create({
          data: { tenantId, roleId: branchAdmin.id, permissionId: id },
        });
      }

      const recvUser = await owner.user.create({
        data: {
          tenantId,
          code: 'RC1',
          email: `rc_${stamp}@example.test`,
          displayName: 'Recv',
          passwordHash: 'x',
        },
      });
      const adminUser = await owner.user.create({
        data: {
          tenantId,
          code: 'BA1',
          email: `ba_${stamp}@example.test`,
          displayName: 'Admin',
          passwordHash: 'x',
        },
      });
      await owner.userBranch.create({
        data: { tenantId, userId: recvUser.id, branchId },
      });
      await owner.userBranch.create({
        data: { tenantId, userId: adminUser.id, branchId },
      });
      await owner.roleAssignment.create({
        data: {
          tenantId,
          userId: recvUser.id,
          roleId: receptionist.id,
          scopeType: 'BRANCH',
          branches: { create: [{ branchId }] },
        },
      });
      await owner.roleAssignment.create({
        data: {
          tenantId,
          userId: adminUser.id,
          roleId: branchAdmin.id,
          scopeType: 'BRANCH',
          branches: { create: [{ branchId }] },
        },
      });

      const module = await owner.module.upsert({
        where: { code: 'OPD' },
        create: { code: 'OPD', name: 'Outpatient' },
        update: { isActive: true },
      });
      await owner.hospitalModuleSubscription.create({
        data: { tenantId, moduleId: module.id },
      });
      await owner.branchModule.create({
        data: {
          tenantId,
          branchId,
          moduleId: module.id,
          enabledByIndigo: true,
          restrictedByHospital: false,
          isActive: true,
        },
      });

      const access = new AccessService(createTenantDb(app));
      const asUser = <T>(userId: string, fn: () => Promise<T>) =>
        runWithContext(hospitalContext(tenantId, { userId, activeBranchId: branchId }), fn);

      await expect(
        asUser(recvUser.id, () => access.can('opd.masters.read', branchId)),
      ).resolves.toBe(true);
      await expect(
        asUser(recvUser.id, () => access.can('opd.prices.write', branchId)),
      ).resolves.toBe(false);
      await expect(
        asUser(recvUser.id, () => access.can('opd.settings.write', branchId)),
      ).resolves.toBe(false);

      await expect(
        asUser(adminUser.id, () => access.can('opd.masters.read', branchId)),
      ).resolves.toBe(true);
      await expect(
        asUser(adminUser.id, () => access.can('opd.prices.write', branchId)),
      ).resolves.toBe(true);
      await expect(
        asUser(adminUser.id, () => access.can('opd.settings.write', branchId)),
      ).resolves.toBe(true);
    });
  });

  describe('production guard', () => {
    it('still refuses a test hospital seed outside development', () => {
      expect(() => assertDevTenantSeedAllowed('production')).toThrow(/development/i);
      expect(() => assertDevTenantSeedAllowed('test')).toThrow(/development/i);
    });
  });
});
