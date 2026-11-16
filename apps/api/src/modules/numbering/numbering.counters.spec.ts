import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { FakeClock } from '../../common/clock';
import {
  asHospital,
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  createTenantDb,
  requireTestDatabaseUrl,
  withTenant,
} from '../../database/db-test.util';
import { NumberSeriesService } from './number-series.service';
import { TokenCounterService } from './token-counter.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function patientUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_PATIENT;
  if (!raw) {
    throw new Error('DATABASE_URL_PATIENT required');
  }
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

describe('Number counters (hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(90_000);

  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  const clock = new FakeClock(new Date('2026-06-15T12:00:00.000Z'));
  const tenantDb = createTenantDb(app);
  const series = new NumberSeriesService(clock);
  const tokens = new TokenCounterService(clock);

  let tenantA: string;
  let tenantB: string;
  let branchAMain: string;
  let branchAEast: string;
  let branchBMain: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const ha = await owner.hospital.create({
      data: {
        code: `CNT_A_${stamp}`,
        name: 'Counter A',
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `cnt-a-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `cnt-a-e-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    const hb = await owner.hospital.create({
      data: {
        code: `CNT_B_${stamp}`,
        name: 'Counter B',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `cnt-b-${stamp}` },
        },
      },
      include: { branches: true },
    });
    tenantA = ha.id;
    tenantB = hb.id;
    branchAMain = ha.branches.find((b) => b.code === 'MAIN')!.id;
    branchAEast = ha.branches.find((b) => b.code === 'EAST')!.id;
    branchBMain = hb.branches[0]!.id;

    for (const tid of [tenantA, tenantB]) {
      await owner.opdSettings.create({
        data: { tenantId: tid, timezone: 'Asia/Kolkata', tokenPrefix: 'T' },
      });
      for (const seriesKind of ['BILL', 'RECEIPT', 'REFUND'] as const) {
        await owner.numberSeriesSettings.create({
          data: {
            tenantId: tid,
            series: seriesKind,
            format: [
              { type: 'FINANCIAL_YEAR', style: 'SHORT' },
              { type: 'SEPARATOR', text: '/' },
              { type: 'RUNNING', width: 5 },
            ],
            resetRule: 'FINANCIAL_YEAR',
            fyStartMonth: 4,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  async function allocBill(tenantId: string, now?: Date) {
    return asHospital(tenantId, () =>
      tenantDb.withTenant((tx) => series.allocate({ tenantId, series: 'BILL', tx, now })),
    );
  }

  async function allocToken(tenantId: string, branchId: string, now?: Date) {
    return asHospital(tenantId, () =>
      tenantDb.withTenant((tx) => tokens.allocate({ tenantId, branchId, tx, now })),
    );
  }

  it('50 parallel bill allocations are distinct and consecutive', async () => {
    clock.set(new Date('2026-06-15T12:00:00.000Z'));
    const results = await Promise.all(Array.from({ length: 50 }, () => allocBill(tenantA)));
    const nums = results.map((r) => Number(r.number)).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(50);
    expect(nums[49]! - nums[0]!).toBe(49);
    expect(results.every((r) => r.periodYear === 2026)).toBe(true);
  });

  it('50 parallel token allocations in one branch are distinct and consecutive', async () => {
    clock.set(new Date('2026-06-15T12:00:00.000Z'));
    const results = await Promise.all(
      Array.from({ length: 50 }, () => allocToken(tenantA, branchAMain)),
    );
    const nums = results.map((r) => r.tokenNo).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(50);
    expect(nums[49]! - nums[0]!).toBe(49);
    expect(results.every((r) => r.tokenDate === '2026-06-15')).toBe(true);
    expect(results[0]!.label).toBe(`T${results[0]!.tokenNo}`);
  });

  it('rolled-back transaction leaves no gap (next number repeats it)', async () => {
    clock.set(new Date('2026-07-01T12:00:00.000Z'));
    const first = await allocBill(tenantA);
    await expect(
      asHospital(tenantA, () =>
        tenantDb.withTenant(async (tx) => {
          await series.allocate({ tenantId: tenantA, series: 'BILL', tx });
          throw new Error('force-rollback');
        }),
      ),
    ).rejects.toThrow(/force-rollback/);
    const again = await allocBill(tenantA);
    expect(Number(again.number)).toBe(Number(first.number) + 1);
  });

  it('financial-year rollover and NEVER reset with a fixed clock', async () => {
    const stamp = Date.now();
    const hospital = await owner.hospital.create({
      data: {
        code: `CNT_FY_${stamp}`,
        name: 'FY Counter',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `cnt-fy-${stamp}` },
        },
      },
      include: { branches: true },
    });
    const tid = hospital.id;
    await owner.opdSettings.create({
      data: { tenantId: tid, timezone: 'Asia/Kolkata', tokenPrefix: 'T' },
    });
    await owner.numberSeriesSettings.create({
      data: {
        tenantId: tid,
        series: 'RECEIPT',
        format: [
          { type: 'FINANCIAL_YEAR', style: 'SHORT' },
          { type: 'SEPARATOR', text: '/' },
          { type: 'RUNNING', width: 3 },
        ],
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: 4,
      },
    });
    await owner.numberSeriesSettings.create({
      data: {
        tenantId: tid,
        series: 'REFUND',
        format: [
          { type: 'FIXED', text: 'R' },
          { type: 'FINANCIAL_YEAR', style: 'SHORT' },
          { type: 'RUNNING', width: 3 },
        ],
        resetRule: 'NEVER',
        fyStartMonth: 4,
      },
    });

    clock.set(new Date('2026-03-15T12:00:00.000Z')); // before April → FY 2025
    const before = await asHospital(tid, () =>
      tenantDb.withTenant((tx) => series.allocate({ tenantId: tid, series: 'RECEIPT', tx })),
    );
    expect(before.periodYear).toBe(2025);
    expect(before.formatted).toMatch(/^2526\//);

    clock.set(new Date('2026-04-15T12:00:00.000Z')); // April → FY 2026
    const after = await asHospital(tid, () =>
      tenantDb.withTenant((tx) => series.allocate({ tenantId: tid, series: 'RECEIPT', tx })),
    );
    expect(after.periodYear).toBe(2026);
    expect(Number(after.number)).toBe(1);

    clock.set(new Date('2027-01-01T12:00:00.000Z'));
    const never1 = await asHospital(tid, () =>
      tenantDb.withTenant((tx) => series.allocate({ tenantId: tid, series: 'REFUND', tx })),
    );
    const never2 = await asHospital(tid, () =>
      tenantDb.withTenant((tx) => series.allocate({ tenantId: tid, series: 'REFUND', tx })),
    );
    expect(never1.periodYear).toBe(0);
    expect(never2.periodYear).toBe(0);
    expect(Number(never2.number)).toBe(Number(never1.number) + 1);
  });

  it('token day changes at midnight IST (UTC evening is next IST day)', async () => {
    clock.set(new Date('2026-06-14T18:29:00.000Z')); // 23:59 IST
    const before = await allocToken(tenantA, branchAEast);
    expect(before.tokenDate).toBe('2026-06-14');

    clock.set(new Date('2026-06-14T18:31:00.000Z')); // 00:01 IST next day
    const after = await allocToken(tenantA, branchAEast);
    expect(after.tokenDate).toBe('2026-06-15');
    expect(after.tokenNo).toBe(1);
  });

  it('separate counters for different branches and hospitals', async () => {
    clock.set(new Date('2026-08-01T12:00:00.000Z'));
    const aMain = await allocToken(tenantA, branchAMain);
    const aEast = await allocToken(tenantA, branchAEast);
    const bMain = await allocToken(tenantB, branchBMain);
    expect(aMain.tokenNo).toBeGreaterThan(0);
    expect(aEast.tokenNo).toBe(1);
    expect(bMain.tokenNo).toBe(1);

    const billA = await allocBill(tenantA);
    const billB = await allocBill(tenantB);
    expect(billA.number).not.toEqual(billB.number);
  });

  it('RLS isolation and no DELETE grant; hq and patient denied', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      for (const table of ['number_series', 'token_counters']) {
        const del = await client.query<{ ok: boolean }>(
          `SELECT has_table_privilege('hospigo_app', $1, 'DELETE') AS ok`,
          [`public.${table}`],
        );
        expect({ table, delete: del.rows[0]?.ok }).toEqual({ table, delete: false });
      }

      await withTenant(client, tenantA, async () => {
        const seen = await client.query(
          `SELECT 1 FROM number_series WHERE tenant_id = $1 LIMIT 1`,
          [tenantB],
        );
        expect(seen.rowCount).toBe(0);
        const upd = await client.query(
          `UPDATE number_series SET last_number = last_number WHERE tenant_id = $1 RETURNING tenant_id`,
          [tenantB],
        );
        expect(upd.rowCount).toBe(0);
      });
    } finally {
      await client.end();
    }

    const hq = createPgClient('hq');
    await hq.connect();
    try {
      await expect(hq.query(`SELECT 1 FROM number_series`)).rejects.toThrow();
      await expect(hq.query(`SELECT 1 FROM token_counters`)).rejects.toThrow();
    } finally {
      await hq.end();
    }

    const patient = new Client({
      connectionString: patientUrlOnTestDb(),
      connectionTimeoutMillis: 5000,
    });
    await patient.connect();
    try {
      await expect(patient.query(`SELECT 1 FROM number_series`)).rejects.toThrow();
      await expect(patient.query(`SELECT 1 FROM token_counters`)).rejects.toThrow();
    } finally {
      await patient.end();
    }
  });
});
