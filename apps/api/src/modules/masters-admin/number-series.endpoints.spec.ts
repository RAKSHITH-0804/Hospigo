import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { resolvePeriodYear } from '../patients/uhid.util';

prepareTestEnv();

type Cast = { h: KitHospital; admin: string; branchAdmin: string; nobody: string; recv: string };
type Item = {
  series: string;
  configured: boolean;
  editable: boolean;
  prefix: string;
  separator: string;
  fyStyle: string;
  width: number;
  resetRule: string;
  fyStartMonth: number;
  locked: boolean;
  lastNumber: string;
  next: string;
};

// 24 Nov 2026, 10:00 in Asia/Kolkata: the financial year that started in April 2026 (period 2026)
const NOW = new Date('2026-11-24T04:30:00Z');

describe('Number series settings (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(NOW);
  let app: INestApplication;
  let A: Cast;
  let B: Cast;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function seed(label: string, kit: ReturnType<typeof createKit>): Promise<Cast> {
    const h = await kit.hospital(label);
    const cast = await kit.cast(h);
    const recv = await kit.person(h, 'recv', [h.main], {
      permissions: ['opd.visits.read', 'opd.billing.collect'],
      scope: 'BRANCH',
    });
    return {
      h,
      admin: cast.admin,
      branchAdmin: cast.branchAdmin,
      nobody: cast.nobody,
      recv: recv.token(h.main),
    };
  }

  /** The settings rows of a hospital as the starter would make them (REFUND is left out on purpose). */
  async function settings(c: Cast, series: 'BILL' | 'RECEIPT', format: unknown) {
    await owner.numberSeriesSettings.create({
      data: {
        tenantId: c.h.tenant,
        series,
        format: format as object,
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: 4,
      },
    });
  }

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    const kit = createKit(owner, booted.tokens);
    A = await seed('A', kit);
    B = await seed('B', kit);
    await settings(A, 'BILL', [
      { type: 'FIXED', text: 'B' },
      { type: 'FINANCIAL_YEAR', style: 'SHORT' },
      { type: 'SEPARATOR', text: '/' },
      { type: 'RUNNING', width: 5 },
    ]);
    // a format of another shape (a custom one): shown, not edited
    await settings(A, 'RECEIPT', [
      { type: 'FIXED', text: 'R-' },
      { type: 'RUNNING', width: 4 },
      { type: 'FINANCIAL_YEAR', style: 'SHORT' },
    ]);
    await settings(B, 'BILL', [
      { type: 'FINANCIAL_YEAR', style: 'LONG' },
      { type: 'RUNNING', width: 3 },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  const items = async (c: Cast) =>
    (await http().get('/settings/number-series').set(auth(c.admin)).expect(200)).body
      .items as Item[];
  const one = async (c: Cast, series: string) => (await items(c)).find((i) => i.series === series)!;
  const put = (c: Cast, series: string, body: unknown) =>
    http()
      .put(`/settings/number-series/${series}`)
      .set(auth(c.admin))
      .send(body as object);
  const start = (c: Cast, series: string, body: unknown) =>
    http()
      .put(`/settings/number-series/${series}/start-number`)
      .set(auth(c.admin))
      .send(body as object);
  const periodOf = (rule: 'NEVER' | 'FINANCIAL_YEAR') =>
    resolvePeriodYear(NOW, rule, 4, 'Asia/Kolkata');

  // ------------------------------------------------------------------ who may use it

  it('needs a token (401); only a hospital-wide Admin may use it (a Branch Admin, reception and nobody get 403)', async () => {
    const calls: Array<(t?: string) => request.Test> = [
      (t) => withAuth(http().get('/settings/number-series'), t),
      (t) => withAuth(http().put('/settings/number-series/BILL').send({ prefix: 'X' }), t),
      (t) =>
        withAuth(
          http()
            .put('/settings/number-series/BILL/start-number')
            .send({ startNumber: 5, reason: 'x' }),
          t,
        ),
    ];
    function withAuth(r: request.Test, token?: string): request.Test {
      return token ? r.set(auth(token)) : r;
    }
    for (const call of calls) {
      expect((await call()).status).toBe(401);
      for (const who of [A.branchAdmin, A.recv, A.nobody]) {
        expect((await call(who)).status).toBe(403);
      }
    }
  });

  // ------------------------------------------------------------------ reading

  it('shows each series: its parts, the next number as it will look, and whether it is locked', async () => {
    const listed = await http().get('/settings/number-series').set(auth(A.admin)).expect(200);
    expect(listed.body.today).toBe('2026-11-24');
    const bill = await one(A, 'BILL');
    expect(bill).toMatchObject({
      configured: true,
      editable: true,
      prefix: 'B',
      separator: '/',
      fyStyle: 'SHORT',
      width: 5,
      resetRule: 'FINANCIAL_YEAR',
      fyStartMonth: 4,
      locked: false,
      lastNumber: '0',
      next: 'B2627/00001',
    });
    // a format of another shape is shown (with its next number) but not editable
    expect(await one(A, 'RECEIPT')).toMatchObject({
      configured: true,
      editable: false,
      next: 'R-00012627',
    });
    // a series the hospital never configured
    expect(await one(A, 'REFUND')).toMatchObject({ configured: false, editable: false });
  });

  // ------------------------------------------------------------------ changing the format

  it('before the first number everything may change; the preview follows', async () => {
    const res = await put(A, 'BILL', {
      prefix: 'INV',
      separator: '-',
      fyStyle: 'LONG',
      width: 6,
      resetRule: 'NEVER',
      fyStartMonth: 1,
    }).expect(200);
    expect(res.body).toMatchObject({
      prefix: 'INV',
      separator: '-',
      fyStyle: 'LONG',
      width: 6,
      resetRule: 'NEVER',
      fyStartMonth: 1,
      locked: false,
    });
    expect(res.body.next).toBe('INV2026-27-000001');
  });

  it('refuses bad parts, unknown fields, an empty change, an unknown series and a series that is not set up', async () => {
    const reason = async (body: unknown, status = 400) =>
      (await put(A, 'BILL', body).expect(status)).body.reason as string;
    expect(await reason({ prefix: 'a b' })).toBe('PREFIX_INVALID');
    expect(await reason({ prefix: 'TOO-LONG-PREFIX' })).toBe('TOO_LONG');
    expect(await reason({ prefix: '<b>' })).toBe('PREFIX_INVALID');
    expect(await reason({ separator: '#' })).toBe('SEPARATOR_INVALID');
    expect(await reason({ fyStyle: 'MEDIUM' })).toBe('STYLE_INVALID');
    expect(await reason({ width: 0 })).toBe('WIDTH_INVALID');
    expect(await reason({ width: 11 })).toBe('WIDTH_INVALID');
    expect(await reason({ width: '5' })).toBe('WIDTH_INVALID');
    expect(await reason({ resetRule: 'MONTHLY' })).toBe('RESET_INVALID');
    expect(await reason({ fyStartMonth: 13 })).toBe('MONTH_INVALID');
    expect(await reason({ format: [] })).toBe('UNKNOWN_FIELD');
    expect(await reason({})).toBe('NOTHING_TO_CHANGE');
    await put(A, 'NOPE', { prefix: 'X' }).expect(404);
    expect((await put(A, 'REFUND', { prefix: 'X' }).expect(409)).body.reason).toBe(
      'NOT_CONFIGURED',
    );
    expect((await put(A, 'RECEIPT', { prefix: 'X' }).expect(409)).body.reason).toBe(
      'CUSTOM_FORMAT',
    );
  });

  // ------------------------------------------------------------------ locking after the first number

  it('once a number exists the reset rule and the financial year start are locked (API and database); the prefix may still change and counts on', async () => {
    // reset the series to a known state, then issue a number the way billing does (counter row)
    await put(A, 'BILL', {
      prefix: 'B',
      separator: '/',
      fyStyle: 'SHORT',
      width: 5,
      resetRule: 'FINANCIAL_YEAR',
      fyStartMonth: 4,
    }).expect(200);
    await owner.numberSeries.create({
      data: {
        tenantId: A.h.tenant,
        series: 'BILL',
        periodYear: periodOf('FINANCIAL_YEAR'),
        lastNumber: BigInt(41),
      },
    });
    const view = await one(A, 'BILL');
    expect(view).toMatchObject({ locked: true, lastNumber: '41', next: 'B2627/00042' });
    expect((await put(A, 'BILL', { resetRule: 'NEVER' }).expect(409)).body.reason).toBe(
      'LOCKED_AFTER_USE',
    );
    expect((await put(A, 'BILL', { fyStartMonth: 1 }).expect(409)).body.reason).toBe(
      'LOCKED_AFTER_USE',
    );
    expect(
      (await put(A, 'BILL', { prefix: 'B', resetRule: 'FINANCIAL_YEAR' }).expect(200)).body.next,
    ).toBe('B2627/00042');
    // the database refuses it as well, whoever asks
    await expect(
      owner.numberSeriesSettings.update({
        where: { tenantId_series: { tenantId: A.h.tenant, series: 'BILL' } },
        data: { resetRule: 'NEVER' },
      }),
    ).rejects.toThrow(/cannot change after its first number/);
    // the prefix changes only the new numbers: the counter goes on at 42
    const changed = await put(A, 'BILL', { prefix: 'INV', width: 3 }).expect(200);
    expect(changed.body).toMatchObject({
      prefix: 'INV',
      width: 3,
      locked: true,
      lastNumber: '41',
      next: 'INV2627/042',
    });
  });

  it('the database keeps every counter: it cannot go down, be deleted, emptied or moved to another period', async () => {
    const where = {
      tenantId_series_periodYear: {
        tenantId: A.h.tenant,
        series: 'BILL' as const,
        periodYear: periodOf('FINANCIAL_YEAR'),
      },
    };
    await expect(
      owner.numberSeries.update({ where, data: { lastNumber: BigInt(5) } }),
    ).rejects.toThrow(/forward/);
    await expect(owner.numberSeries.update({ where, data: { periodYear: 1999 } })).rejects.toThrow(
      /keeps its hospital, series and period/,
    );
    await expect(owner.numberSeries.delete({ where })).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe('TRUNCATE number_series')).rejects.toThrow(
      /append-only|truncate/i,
    );
    expect((await owner.numberSeries.findUniqueOrThrow({ where })).lastNumber).toBe(BigInt(41));
    // forward is fine
    await owner.numberSeries.update({ where, data: { lastNumber: BigInt(41) } });
  });

  // ------------------------------------------------------------------ the start number

  it('the start number is raise-only, needs a reason, makes the next number what was asked and locks the series', async () => {
    // hospital B: BILL has never issued a number
    expect((await one(B, 'BILL')).locked).toBe(false);
    const raised = await start(B, 'BILL', {
      startNumber: 1000,
      reason: 'Continuing from the paper book',
    }).expect(200);
    expect(raised.body).toMatchObject({ locked: true, lastNumber: '999', next: '2026-271000' });
    // lowering is refused, the same number is a quiet no-op, a higher one is fine
    expect(
      (await start(B, 'BILL', { startNumber: 500, reason: 'back' }).expect(409)).body.reason,
    ).toBe('NOT_RAISING');
    expect(
      (await start(B, 'BILL', { startNumber: 1000, reason: 'again' }).expect(200)).body.lastNumber,
    ).toBe('999');
    expect(
      (await start(B, 'BILL', { startNumber: 2000, reason: 'more' }).expect(200)).body.lastNumber,
    ).toBe('1999');
    // bad input
    const bad = async (body: unknown) =>
      (await start(B, 'BILL', body).expect(400)).body.reason as string;
    expect(await bad({ startNumber: 0, reason: 'x' })).toBe('START_INVALID');
    expect(await bad({ startNumber: 1.5, reason: 'x' })).toBe('START_INVALID');
    expect(await bad({ startNumber: 5_000_000_000, reason: 'x' })).toBe('START_INVALID');
    expect(await bad({ startNumber: 5 })).toBe('REQUIRED');
    expect(await bad({ startNumber: 5, reason: '   ' })).toBe('REQUIRED');
    expect(await bad({ startNumber: 5, reason: '<script>' })).toBe('NOT_PLAIN_TEXT');
    expect(await bad({ startNumber: 5, reason: 'ok', extra: 1 })).toBe('UNKNOWN_FIELD');
    await start(B, 'NOPE', { startNumber: 5, reason: 'x' }).expect(404);
    expect(
      (await start(B, 'REFUND', { startNumber: 5, reason: 'x' }).expect(409)).body.reason,
    ).toBe('NOT_CONFIGURED');
  });

  it('raises at the same moment never lower the count: the highest wins, nothing is lost or repeated', async () => {
    await settings(B, 'RECEIPT', [
      { type: 'FINANCIAL_YEAR', style: 'LONG' },
      { type: 'RUNNING', width: 4 },
    ]);
    const asked = [3000, 5000, 4000, 4500];
    const calls = await Promise.all(
      asked.map((n) => start(B, 'RECEIPT', { startNumber: n, reason: 'race ' + n })),
    );
    // each request is either accepted or told it does not raise the count; nothing else
    for (const c of calls) {
      expect([200, 409]).toContain(c.status);
      if (c.status === 409) {
        expect(c.body.reason).toBe('NOT_RAISING');
      }
    }
    expect(calls.some((c) => c.status === 200)).toBe(true);
    // the count ends at the highest asked number, whatever the order they ran in
    expect((await one(B, 'RECEIPT')).lastNumber).toBe('4999');
    const rows = await owner.numberSeries.findMany({
      where: { tenantId: B.h.tenant, series: 'RECEIPT' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastNumber.toString()).toBe('4999');
  });

  it('the audit trail keeps ids, series, field names and numbers; the reason of a start number is kept as the reason', async () => {
    const rows = await owner.auditLog.findMany({
      where: { tenantId: B.h.tenant, action: 'NUMBER_SERIES_CHANGE' },
      orderBy: { createdAt: 'asc' },
    });
    const first = rows.find((r) => (r.metadata as { kind: string }).kind === 'START_NUMBER')!;
    expect(first.reason).toBe('Continuing from the paper book');
    expect(first.metadata).toMatchObject({ series: 'BILL', from: '0', to: '999' });
    const aRows = await owner.auditLog.findMany({
      where: { tenantId: A.h.tenant, action: 'NUMBER_SERIES_CHANGE' },
    });
    const withFields = aRows
      .map((r) => r.metadata as { kind: string; changed?: string[] })
      .filter((m) => m.kind === 'UPDATE');
    expect(withFields.length).toBeGreaterThan(0);
    for (const m of withFields) {
      for (const field of m.changed ?? []) {
        expect(['prefix', 'separator', 'fyStyle', 'width', 'resetRule', 'fyStartMonth']).toContain(
          field,
        );
      }
    }
    expect(JSON.stringify(aRows.map((r) => r.metadata))).not.toContain('INV');
  });

  it("another hospital's series is never touched", async () => {
    const before = await owner.numberSeriesSettings.findUniqueOrThrow({
      where: { tenantId_series: { tenantId: B.h.tenant, series: 'BILL' } },
    });
    await put(A, 'BILL', { prefix: 'ZZ' }).expect(200);
    const after = await owner.numberSeriesSettings.findUniqueOrThrow({
      where: { tenantId_series: { tenantId: B.h.tenant, series: 'BILL' } },
    });
    expect(after.format).toEqual(before.format);
    expect((await one(B, 'BILL')).prefix).toBe('');
  });
});
