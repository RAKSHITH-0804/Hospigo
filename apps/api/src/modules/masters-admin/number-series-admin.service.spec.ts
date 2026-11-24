import type { Clock } from '../../common/clock';
import type { TenantDb } from '../../database/tenant-db';
import type { AccessService } from '../access/access.service';
import { NumberSeriesAdminService } from './number-series-admin.service';

const NOW = new Date('2026-11-24T04:30:00Z'); // period 2026 (financial year 2026-27)

type Counter = { periodYear: number; lastNumber: bigint };

/** The service on a stand-in database: settings of one BILL series, its counters and the numbers already issued. */
function setup(opts: { issued?: string[]; counters?: Counter[]; hospitalWide?: boolean }) {
  const counters = opts.counters ?? [];
  const issued = new Set(opts.issued ?? []);
  const state = {
    format: [
      { type: 'FIXED', text: 'B' },
      { type: 'FINANCIAL_YEAR', style: 'SHORT' },
      { type: 'SEPARATOR', text: '/' },
      { type: 'RUNNING', width: 5 },
    ] as unknown,
    updates: [] as unknown[],
    audits: [] as unknown[],
  };
  const tx = {
    opdSettings: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ timezone: 'Asia/Kolkata' }),
    },
    numberSeriesSettings: {
      findUnique: async () => ({
        id: 's1',
        format: state.format,
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: 4,
      }),
      update: async (args: { data: { format?: unknown } }) => {
        state.updates.push(args.data);
        if (args.data.format) state.format = args.data.format;
      },
    },
    numberSeries: {
      findMany: async () => counters,
      findUnique: async () => counters.find((c) => c.periodYear === 2026) ?? null,
      updateMany: async (args: {
        where: { lastNumber: { lt: bigint } };
        data: { lastNumber: bigint };
      }) => {
        const row = counters.find((c) => c.periodYear === 2026);
        if (row && row.lastNumber < args.where.lastNumber.lt) {
          row.lastNumber = args.data.lastNumber;
          return { count: 1 };
        }
        return { count: 0 };
      },
      create: async (args: { data: Counter }) => {
        counters.push({ periodYear: args.data.periodYear, lastNumber: args.data.lastNumber });
      },
    },
    bill: {
      findFirst: async (args: { where: { billNumber: { in: string[] } } }) =>
        args.where.billNumber.in.some((n) => issued.has(n)) ? { id: 'b' } : null,
    },
    auditLog: { create: async (args: unknown) => void state.audits.push(args) },
  };
  const tenantDb = {
    withTenant: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as TenantDb;
  const access = {
    hospitalWideBranches: async () => (opts.hospitalWide === false ? [] : ['branch']),
  } as unknown as AccessService;
  const clock: Clock = { now: () => NOW };
  return { service: new NumberSeriesAdminService(tenantDb, access, clock), state, counters };
}

const actor = { tenantId: 't', userId: 'u' };
const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    const body = (error as { response?: { code?: string; reason?: string } }).response;
    return `${body?.code}:${body?.reason}`;
  }
  return 'OK';
};

describe('NumberSeriesAdminService (the rules, on a stand-in database)', () => {
  it('a format change that would give a number already issued is refused, and a harmless one is saved', async () => {
    // numbers up to 41 are issued with width 5; a width of 3 would give B2627/042 next, which exists
    const { service, state } = setup({
      counters: [{ periodYear: 2026, lastNumber: BigInt(41) }],
      issued: ['B2627/042'],
    });
    expect(await reasonOf(service.update(actor, 'BILL', { width: 3 }))).toBe(
      'MASTER_CONFLICT:NUMBER_EXISTS',
    );
    expect(state.updates).toHaveLength(0);
    const view = await service.update(actor, 'BILL', { prefix: 'INV' });
    expect(view).toMatchObject({
      prefix: 'INV',
      lastNumber: '41',
      next: 'INV2627/00042',
      locked: true,
    });
    expect(state.updates).toHaveLength(1);
  });

  it('a number later than the first 1000 ahead is not checked, but the database unique key still stops a repeat', async () => {
    const { service } = setup({
      counters: [{ periodYear: 2026, lastNumber: BigInt(41) }],
      issued: ['B2627/1042'], // width 1 would give this at number 1042: 1000 numbers ahead of 42 is 1041
    });
    expect(await reasonOf(service.update(actor, 'BILL', { width: 1 }))).toBe('OK');
  });

  it('the reset rule and the financial year start cannot change after the first number, and can before it', async () => {
    const used = setup({ counters: [{ periodYear: 2026, lastNumber: BigInt(1) }] });
    expect(await reasonOf(used.service.update(actor, 'BILL', { resetRule: 'NEVER' }))).toBe(
      'MASTER_CONFLICT:LOCKED_AFTER_USE',
    );
    expect(await reasonOf(used.service.update(actor, 'BILL', { fyStartMonth: 1 }))).toBe(
      'MASTER_CONFLICT:LOCKED_AFTER_USE',
    );
    const fresh = setup({ counters: [] });
    expect(await reasonOf(fresh.service.update(actor, 'BILL', { resetRule: 'NEVER' }))).toBe('OK');
  });

  it('the start number only raises the counter, to the number before the one asked for, and the same number changes nothing', async () => {
    const { service, counters, state } = setup({
      counters: [{ periodYear: 2026, lastNumber: BigInt(10) }],
    });
    expect(
      (await service.setStartNumber(actor, 'BILL', { startNumber: 500, reason: 'paper book' }))
        .lastNumber,
    ).toBe('499');
    expect(counters[0]!.lastNumber).toBe(BigInt(499));
    expect(
      await reasonOf(service.setStartNumber(actor, 'BILL', { startNumber: 100, reason: 'down' })),
    ).toBe('MASTER_CONFLICT:NOT_RAISING');
    expect(counters[0]!.lastNumber).toBe(BigInt(499));
    const audits = state.audits.length;
    await service.setStartNumber(actor, 'BILL', { startNumber: 500, reason: 'same' });
    expect(state.audits.length).toBe(audits); // nothing changed, nothing written
  });

  it('a start number that would give an issued number is refused; a series without a counter gets one', async () => {
    const taken = setup({
      counters: [{ periodYear: 2026, lastNumber: BigInt(10) }],
      issued: ['B2627/00500'],
    });
    expect(
      await reasonOf(
        taken.service.setStartNumber(actor, 'BILL', { startNumber: 500, reason: 'x' }),
      ),
    ).toBe('MASTER_CONFLICT:NUMBER_EXISTS');
    const fresh = setup({ counters: [] });
    const view = await fresh.service.setStartNumber(actor, 'BILL', {
      startNumber: 1000,
      reason: 'migration',
    });
    expect(view).toMatchObject({ locked: true, lastNumber: '999', next: 'B2627/01000' });
    expect(fresh.counters).toHaveLength(1);
  });

  it('only a hospital-wide Admin may use it', async () => {
    const { service } = setup({ hospitalWide: false });
    expect(await reasonOf(service.list(actor))).toBe('FORBIDDEN:undefined');
    expect(await reasonOf(service.update(actor, 'BILL', { prefix: 'X' }))).toBe(
      'FORBIDDEN:undefined',
    );
  });
});
