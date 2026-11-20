import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CLOCK, FakeClock } from '../../common/clock';
import { createOwnerPrisma, createPgClient } from '../../database/db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the OPD report tests`);
  }
  const u = new URL(raw);
  if (owner) {
    if (u.pathname.replace(/^\//, '') !== 'hospigo_test') {
      throw new Error('Refusing a non-test owner database');
    }
    return u.toString();
  }
  u.pathname = '/hospigo_test';
  return u.toString();
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '',
  DATABASE_URL_OWNER: testUrl(
    process.env.DATABASE_URL_OWNER_TEST ? 'DATABASE_URL_OWNER_TEST' : 'DATABASE_URL_OWNER',
    true,
  ),
  DATABASE_URL_HQ: testUrl('DATABASE_URL_HQ'),
  DATABASE_URL_PATIENT: testUrl('DATABASE_URL_PATIENT'),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
});

const FY_FORMAT = [
  { type: 'FINANCIAL_YEAR', style: 'SHORT' },
  { type: 'SEPARATOR', text: '/' },
  { type: 'RUNNING', width: 5 },
];
const DOCTOR_PERMS = [
  'opd.masters.read',
  'opd.visits.read',
  'opd.queue.read',
  'opd.notes.read',
  'opd.notes.write',
  'opd.investigations.order',
] as const;
const RECEPTION_PERMS = [
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'opd.investigations.bill',
  'opd.refunds.request',
  'patients.registry.read',
] as const;
const ADMIN_PERMS = [
  'opd.visits.read',
  'opd.billing.read',
  'opd.refunds.approve',
  'opd.reports.read',
] as const;
const ALL_CODES = [...new Set([...DOCTOR_PERMS, ...RECEPTION_PERMS, ...ADMIN_PERMS])];

/** The byte order mark at the start of a CSV that Excel needs (built from its code, not typed). */
const BOM = String.fromCharCode(0xfeff);

/** JSON bodies of the HTTP responses are checked field by field in these tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

type Hospital = {
  tenant: string;
  main: string;
  east: string;
  user: string;
  doc1: string;
  doc2: string;
  doc3: string;
  items: { a: string; b: string };
  tokens: Record<string, string>;
  users: Record<string, string>;
};

describe('OPD daily collection report (HTTP)', () => {
  jest.setTimeout(240_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}-${stamp}-${(seq += 1)}`;

  async function seedHospital(label: string, timezone = 'Asia/Kolkata'): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `RP_${label}_${stamp}`,
        name: `Report ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `rp-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `rp-${label}-e-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const main = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    const east = hospital.branches.find((b) => b.code === 'EAST')!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    for (const branchId of [main, east]) {
      await owner.branchModule.create({
        data: { tenantId: tenant, branchId, moduleId: opd.id, enabledByIndigo: true },
      });
    }
    await owner.opdSettings.create({
      data: { tenantId: tenant, followUpFreeDays: 7, tokenPrefix: 'T', timezone },
    });
    for (const series of ['BILL', 'RECEIPT', 'REFUND'] as const) {
      await owner.numberSeriesSettings.create({
        data: {
          tenantId: tenant,
          series,
          format: FY_FORMAT,
          resetRule: 'FINANCIAL_YEAR',
          fyStartMonth: 4,
        },
      });
    }
    await owner.paymentMode.create({
      data: { tenantId: tenant, code: 'CASH', name: 'CASH', requiresReference: false },
    });
    await owner.paymentMode.create({
      data: { tenantId: tenant, code: 'UPI', name: 'UPI', requiresReference: true },
    });
    const staff = await owner.user.create({
      data: {
        tenantId: tenant,
        code: `S${label}${stamp}`,
        email: `rp_s_${label}_${stamp}@example.test`,
        displayName: 'Setup',
        passwordHash: 'x',
      },
    });
    const item = async (code: string, kind: 'REGISTRATION' | 'INVESTIGATION', price: number) => {
      const row = await owner.chargeItem.create({
        data: { tenantId: tenant, code, name: `Name ${code}`, kind },
      });
      await owner.chargeItemPrice.create({
        data: {
          tenantId: tenant,
          chargeItemId: row.id,
          amountPaise: price,
          effectiveFrom: new Date('2020-01-01'),
          createdBy: staff.id,
        },
      });
      return row.id;
    };
    await item('REG', 'REGISTRATION', 10_000);
    const items = {
      a: await item('INVA', 'INVESTIGATION', 30_000),
      b: await item('INVB', 'INVESTIGATION', 20_000),
    };

    const perms = await owner.permission.findMany({ where: { code: { in: ALL_CODES } } });
    if (perms.length !== ALL_CODES.length) {
      throw new Error(
        'Report permissions missing from the test catalog (re-run the reference seed)',
      );
    }
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    async function makeUser(
      key: string,
      codes: readonly string[],
      branches: string[],
      opts: { displayName?: string; hospitalScope?: boolean } = {},
    ) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `rp_${key}_${label}_${stamp}@example.test`,
          displayName: opts.displayName ?? `Person ${key} ${label}`,
          passwordHash: 'x',
        },
      });
      for (const branchId of opts.hospitalScope ? [main, east] : branches) {
        await owner.userBranch.create({ data: { tenantId: tenant, userId: u.id, branchId } });
      }
      if (codes.length > 0) {
        const role = await owner.role.create({
          data: { tenantId: tenant, code: `R_${key}_${stamp}`, name: key },
        });
        for (const code of codes) {
          await owner.rolePermission.create({
            data: { tenantId: tenant, roleId: role.id, permissionId: permId[code]! },
          });
        }
        const assignment = await owner.roleAssignment.create({
          data: {
            tenantId: tenant,
            userId: u.id,
            roleId: role.id,
            scopeType: opts.hospitalScope ? 'HOSPITAL' : 'BRANCH',
          },
        });
        if (!opts.hospitalScope) {
          for (const branchId of branches) {
            await owner.roleAssignmentBranch.create({
              data: { tenantId: tenant, assignmentId: assignment.id, branchId },
            });
          }
        }
      }
      users[key] = u.id;
      tokens[key] = tokenService.signHospitalAccess({
        tenantId: tenant,
        userId: u.id,
        branchId: branches[0]!,
      });
      return u;
    }
    await makeUser('recvMain', RECEPTION_PERMS, [main]);
    await makeUser('recvEast', RECEPTION_PERMS, [east]);
    await makeUser('adminMain', ADMIN_PERMS, [main]);
    await makeUser('adminEast', ADMIN_PERMS, [east]);
    await makeUser('adminTwo', ADMIN_PERMS, [main]);
    await makeUser('superAdmin', ADMIN_PERMS, [main], { hospitalScope: true });
    await makeUser('nobody', [], [main]);
    async function makeDoctor(key: string, displayName: string) {
      const u = await makeUser(key, DOCTOR_PERMS, [main, east], { displayName });
      const profile = await owner.doctorProfile.create({
        data: { tenantId: tenant, userId: u.id, code: `DOC_${key}_${label}_${stamp}` },
      });
      for (const type of ['NEW', 'FOLLOW_UP'] as const) {
        await owner.doctorFee.create({
          data: {
            tenantId: tenant,
            doctorProfileId: profile.id,
            visitType: type,
            amountPaise: 50_000,
            effectiveFrom: new Date('2020-01-01'),
            createdBy: staff.id,
          },
        });
      }
      return profile.id;
    }
    const doc1 = await makeDoctor('doc1', 'Doctor One');
    // These two names must never become a spreadsheet formula or break the CSV columns.
    const doc2 = await makeDoctor('doc2', '=SUM(1+1)');
    const doc3 = await makeDoctor('doc3', 'Doctor, "Three"');
    return { tenant, main, east, user: staff.id, doc1, doc2, doc3, items, tokens, users };
  }

  beforeAll(async () => {
    const { AppModule } = await import('../../app.module');
    const { TokenService } = await import('../auth/token.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(() => {
    clock.set(new Date());
  });

  // ------------------------------------------------------------------------------ helpers

  const http = () => request(app.getHttpServer());
  const as = (h: Hospital, who: string) => ({ Authorization: `Bearer ${h.tokens[who]}` });
  const get = (h: Hospital, who: string, url: string) => http().get(url).set(as(h, who));
  const post = (h: Hospital, who: string, url: string, body?: object) =>
    http()
      .post(url)
      .set(as(h, who))
      .send(body ?? {});
  const put = (h: Hospital, who: string, url: string, body: object) =>
    http().put(url).set(as(h, who)).send(body);

  /** The hospital's own calendar day of a moment (what the report calls a day). */
  const dayIn = (timeZone: string, at = new Date()) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  const addDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  let patientCounter = 0;
  async function newPatient(h: Hospital): Promise<string> {
    patientCounter += 1;
    const p = await owner.patient.create({
      data: {
        tenantId: h.tenant,
        uhid: `RP${h.tenant.slice(-6)}${stamp}${patientCounter}`,
        registeredBranchId: h.main,
        name: `Secret Name ${patientCounter}`,
        gender: 'F',
        createdBy: h.user,
      },
    });
    return p.id;
  }

  /** What was really collected and returned, kept by the test itself (the expected numbers). */
  type Book = {
    paid: Record<string, number>;
    refunded: Record<string, number>;
    byDoctor: Record<string, { paid: number; refunded: number; visits: number }>;
  };
  const newBook = (): Book => ({ paid: {}, refunded: {}, byDoctor: {} });
  const add = (m: Record<string, number>, k: string, n: number) => {
    m[k] = (m[k] ?? 0) + n;
  };
  const doctorRow = (b: Book, d: string) => (b.byDoctor[d] ??= { paid: 0, refunded: 0, visits: 0 });

  /** A paid, queued NEW visit through the real reception API (fee 500 + registration 100). */
  async function visit(
    h: Hospital,
    who: string,
    doctor: string,
    book: Book,
    how: 'cash' | 'split' = 'cash',
  ) {
    const res = await post(h, who, '/opd/visits', {
      patientId: await newPatient(h),
      doctorProfileId: doctor,
      visitType: 'NEW',
      idempotencyKey: uniq('KEY-RV'),
      ...(how === 'split'
        ? {
            payments: [
              { paymentModeCode: 'UPI', amountPaise: 30_000, referenceNo: 'U-1' },
              { paymentModeCode: 'CASH', amountPaise: 30_000 },
            ],
          }
        : {}),
    });
    expect([200, 201]).toContain(res.status);
    const total = res.body.bill.totalPaise as number;
    if (how === 'split') {
      add(book.paid, 'UPI', 30_000);
      add(book.paid, 'CASH', total - 30_000);
    } else {
      add(book.paid, 'CASH', total);
    }
    doctorRow(book, doctor).paid += total;
    doctorRow(book, doctor).visits += 1;
    return { id: res.body.id as string, billId: res.body.bill.id as string, total };
  }

  const approve = (h: Hospital, who: string, id: string, body: object = {}) =>
    post(h, who, `/opd/refund-requests/${id}/approve`, body);

  async function refund(
    h: Hospital,
    billId: string,
    amountPaise: number,
    book: Book,
    doctor: string,
    mode: string,
  ) {
    const r = await post(h, 'recvMain', `/opd/bills/${billId}/refund-requests`, {
      amountPaise,
      reason: 'Report test',
      idempotencyKey: uniq('KEY-RF'),
    });
    expect(r.status).toBe(201);
    const ok = await approve(h, 'adminTwo', r.body.request.id);
    expect(ok.status).toBe(200);
    add(book.refunded, mode, amountPaise);
    doctorRow(book, doctor).refunded += amountPaise;
    return r.body.request.id as string;
  }

  const report = (h: Hospital, who: string, date: string, extra = '') =>
    get(h, who, `/opd/reports/daily-collection?date=${date}${extra}`);
  const sum = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);

  /** Moves a payment (and its ledger row) one day back, as if it had been taken yesterday. */
  async function backdate(paymentId: string, days = 1) {
    const c = createPgClient('owner');
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE payments DISABLE TRIGGER payments_refuse_update');
      await c.query(
        `UPDATE payments SET paid_at = paid_at - ($2 || ' days')::interval WHERE id = $1`,
        [paymentId, String(days)],
      );
      await c.query('ALTER TABLE payments ENABLE TRIGGER payments_refuse_update');
      await c.query('ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_refuse_update');
      await c.query(
        `UPDATE ledger_entries SET posted_at = posted_at - ($2 || ' days')::interval WHERE payment_id = $1`,
        [paymentId, String(days)],
      );
      await c.query('ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_refuse_update');
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      await c.end();
    }
  }

  // =================================================================== the main scenario
  // Hospital R: a normal day. Collected and returned money is recorded in `book` as it is made.

  describe('a normal day', () => {
    let R: Hospital;
    const book = newBook();
    const today = dayIn('Asia/Kolkata');
    let v1: { id: string; billId: string; total: number };
    let testsBillId = '';
    let cancelRequest = '';

    beforeAll(async () => {
      R = await seedHospital('R');
      // visit 1 (doctor 1) cash; visit 2 (doctor 2) UPI + cash; visit 4 (doctor 3) cash
      v1 = await visit(R, 'recvMain', R.doc1, book);
      await visit(R, 'recvMain', R.doc2, book, 'split');
      await visit(R, 'recvMain', R.doc3, book);
      // tests for visit 1: ordered by doctor 1, billed in cash at reception (an INVESTIGATION bill)
      expect((await post(R, 'doc1', `/opd/visits/${v1.id}/start`)).status).toBe(200);
      expect(
        (
          await put(R, 'doc1', `/opd/visits/${v1.id}/investigations`, {
            chargeItemIds: [R.items.a, R.items.b],
          })
        ).status,
      ).toBe(200);
      const orders = (await get(R, 'recvMain', `/opd/visits/${v1.id}/investigations`)).body.orders;
      const billed = await post(R, 'recvMain', `/opd/visits/${v1.id}/investigation-bills`, {
        idempotencyKey: uniq('KEY-TB'),
        orderIds: orders.map((o: Loose) => o.id),
      });
      expect(billed.status).toBe(201);
      testsBillId = billed.body.bill.id;
      add(book.paid, 'CASH', 50_000);
      doctorRow(book, R.doc1).paid += 50_000;
      // a part refund of the tests bill (allowed after the consultation started)
      await refund(R, testsBillId, 10_000, book, R.doc1, 'CASH');
      // a waiting visit (doctor 1) cancelled: the whole fee is returned
      const v5 = await visit(R, 'recvMain', R.doc1, book);
      const cancel = await post(R, 'recvMain', `/opd/visits/${v5.id}/cancel-requests`, {
        reason: 'Patient left',
        idempotencyKey: uniq('KEY-CX'),
      });
      expect(cancel.status).toBe(201);
      cancelRequest = cancel.body.request.id;
      expect((await approve(R, 'adminTwo', cancelRequest)).status).toBe(200);
      add(book.refunded, 'CASH', v5.total);
      doctorRow(book, R.doc1).refunded += v5.total;
    });

    it('adds up exactly what was collected and returned: totals, net and counts', async () => {
      const res = await report(R, 'adminMain', today);
      expect(res.status).toBe(200);
      expect(res.body.totals).toMatchObject({
        collectedPaise: sum(book.paid),
        refundedPaise: sum(book.refunded),
        netPaise: sum(book.paid) - sum(book.refunded),
        payments: 6, // visit 1, visit 2 (UPI and cash = two), visit 3, the tests bill, the cancelled visit
        refunds: 2,
      });
      expect(res.body.date).toBe(today);
      expect(res.body.timezone).toBe('Asia/Kolkata');
      expect(res.body.combined).toBe(false);
      expect(res.body.branches.map((b: Loose) => b.code)).toEqual(['MAIN']);
      // visits of the day: four, one of them cancelled; bills: four consultation + one tests bill
      expect(res.body.counts).toEqual({ visits: 4, visitsCancelled: 1, bills: 5 });
    });

    it('splits the same money by payment mode, by doctor and by bill type, each adding up to the total', async () => {
      const res = await report(R, 'adminMain', today);
      const by = (rows: Loose[]) => Object.fromEntries(rows.map((r) => [r.key, r]));
      const modes = by(res.body.byMode);
      expect(modes.CASH).toMatchObject({
        collectedPaise: book.paid.CASH,
        refundedPaise: book.refunded.CASH,
        netPaise: book.paid.CASH! - book.refunded.CASH!,
      });
      expect(modes.UPI).toMatchObject({ collectedPaise: book.paid.UPI, refundedPaise: 0 });
      // every refund went back in the mode it was paid in
      expect(modes.UPI.refunds).toBe(0);

      const doctors = res.body.byDoctor as Loose[];
      expect(doctors).toHaveLength(3);
      for (const [doctorId, expected] of Object.entries(book.byDoctor)) {
        const code = (await owner.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } }))
          .code;
        expect(by(doctors)[code]).toMatchObject({
          collectedPaise: expected.paid,
          refundedPaise: expected.refunded,
          netPaise: expected.paid - expected.refunded,
          visits: expected.visits,
        });
      }
      const types = by(res.body.byBillType);
      expect(types.INVESTIGATION).toMatchObject({ collectedPaise: 50_000, refundedPaise: 10_000 });
      expect(types.CONSULTATION.collectedPaise).toBe(sum(book.paid) - 50_000);

      for (const rows of [res.body.byMode, res.body.byDoctor, res.body.byBillType]) {
        const t = rows as Loose[];
        expect(t.reduce((s, r) => s + r.collectedPaise, 0)).toBe(res.body.totals.collectedPaise);
        expect(t.reduce((s, r) => s + r.refundedPaise, 0)).toBe(res.body.totals.refundedPaise);
        expect(t.every((r) => r.netPaise === r.collectedPaise - r.refundedPaise)).toBe(true);
      }
      // one branch only: no branch split
      expect(res.body.byBranch).toEqual([]);
    });

    it('matches the ledger of the day to the paise', async () => {
      const res = await report(R, 'adminMain', today);
      expect(res.body.ledger).toEqual({
        paymentPaise: sum(book.paid),
        refundPaise: sum(book.refunded),
        matches: true,
      });
    });

    it('reports a day with nothing as zeros, and a refund keeps its own number of rows', async () => {
      const empty = await report(R, 'adminMain', addDays(today, -3));
      expect(empty.status).toBe(200);
      expect(empty.body.totals).toEqual({
        payments: 0,
        refunds: 0,
        collectedPaise: 0,
        refundedPaise: 0,
        netPaise: 0,
      });
      expect(empty.body.counts).toEqual({ visits: 0, visitsCancelled: 0, bills: 0 });
      expect(empty.body.byMode).toEqual([]);
      expect(empty.body.ledger.matches).toBe(true);
    });

    it('only staff with the report permission can read it (deny by default)', async () => {
      for (const url of [
        `/opd/reports/daily-collection?date=${today}`,
        `/opd/reports/daily-collection.csv?date=${today}`,
      ]) {
        expect((await http().get(url)).status).toBe(401);
        expect((await get(R, 'nobody', url)).status).toBe(403);
        expect((await get(R, 'recvMain', url)).status).toBe(403); // reception holds the cash, not the books
        expect((await get(R, 'doc1', url)).status).toBe(403);
        expect((await get(R, 'adminMain', url)).status).toBe(200);
      }
    });

    it('refuses bad input before anything is read', async () => {
      const bad = [
        'date=',
        'date=2026-13-01',
        'date=2026-02-30',
        'date=26-11-20',
        'date=2019-12-31',
        `date=${addDays(today, 1)}`,
        `date=${addDays(today, 400)}`,
        `date=${today}&branch=EVIL`,
        `date=${today}&branch=${R.main}`,
        `date=${today}&tenantId=${R.tenant}`,
        `date=${today}&amount=1`,
      ];
      for (const q of bad) {
        const res = await get(R, 'adminMain', `/opd/reports/daily-collection?${q}`);
        expect({ q, status: res.status }).toEqual({ q, status: 400 });
      }
      expect((await get(R, 'adminMain', '/opd/reports/daily-collection')).status).toBe(400);
    });

    it('a looked-at report is recorded (who, which day, which scope) and never changes any money', async () => {
      const before = await owner.payment.count({ where: { tenantId: R.tenant } });
      const ledgerBefore = await owner.ledgerEntry.count({ where: { tenantId: R.tenant } });
      await report(R, 'adminMain', today);
      await get(R, 'adminMain', `/opd/reports/daily-collection.csv?date=${today}`);
      const rows = await owner.auditLog.findMany({
        where: { tenantId: R.tenant, action: { in: ['OPD_REPORT_VIEW', 'OPD_REPORT_EXPORT'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(
        expect.arrayContaining(['OPD_REPORT_VIEW', 'OPD_REPORT_EXPORT']),
      );
      const last = rows.at(-1)!;
      expect(last.actorUserId).toBe(R.users.adminMain);
      expect(last.metadata).toMatchObject({ date: today, combined: false, branches: 1 });
      expect(JSON.stringify(last.metadata)).not.toMatch(/paise|\d{4,}00/);
      expect(await owner.payment.count({ where: { tenantId: R.tenant } })).toBe(before);
      expect(await owner.ledgerEntry.count({ where: { tenantId: R.tenant } })).toBe(ledgerBefore);
    });

    describe('CSV download', () => {
      const lines = (text: string) => text.slice(BOM.length).trimEnd().split('\r\n');

      it('is a file Excel can open: type, name, BOM, header, and amounts in rupees', async () => {
        const res = await get(
          R,
          'adminMain',
          `/opd/reports/daily-collection.csv?date=${today}`,
        ).buffer(true);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-type']).toContain('utf-8');
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="collection-${today}.csv"`,
        );
        expect(res.headers['cache-control']).toBe('no-store');
        const text = res.text;
        expect(text.startsWith(BOM)).toBe(true);
        const rows = lines(text);
        expect(rows[0]).toBe(
          'date,branches,section,key,name,payments,refunds,collected_rupees,refunded_rupees,net_rupees,visits',
        );
        const total = rows.find((r) => r.includes(',TOTAL,'))!;
        expect(total).toContain(`${today},MAIN,TOTAL,total,Total,6,2,`);
        const rupees = (p: number) => `${Math.trunc(p / 100)}.${String(p % 100).padStart(2, '0')}`;
        expect(total).toContain(
          `,${rupees(sum(book.paid))},${rupees(sum(book.refunded))},${rupees(sum(book.paid) - sum(book.refunded))},4`,
        );
        expect(rows.filter((r) => r.includes(',MODE,'))).toHaveLength(2);
        expect(rows.filter((r) => r.includes(',DOCTOR,'))).toHaveLength(3);
        expect(rows.filter((r) => r.includes(',BILL_TYPE,'))).toHaveLength(2);
        expect(rows.filter((r) => r.includes(',BRANCH,'))).toHaveLength(0);
      });

      it('a doctor name can never run as a formula or break the columns', async () => {
        const res = await get(
          R,
          'adminMain',
          `/opd/reports/daily-collection.csv?date=${today}`,
        ).buffer(true);
        const rows = lines(res.text);
        // "=SUM(1+1)" is written with a leading apostrophe; a name with a comma and quotes is quoted
        expect(rows.some((r) => r.includes(',DOCTOR,') && r.includes(",'=SUM(1+1),"))).toBe(true);
        expect(rows.some((r) => r.includes('"Doctor, ""Three"""'))).toBe(true);
        // the JSON keeps the real name untouched
        const json = await report(R, 'adminMain', today);
        expect(json.body.byDoctor.map((d: Loose) => d.name)).toContain('=SUM(1+1)');
        // no cell of the whole file starts with a formula character
        for (const row of rows.slice(1)) {
          const cells = row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ''));
          for (const cell of cells) {
            expect({ cell, formula: /^[=+@\t\r]/.test(cell) }).toEqual({ cell, formula: false });
          }
        }
      });

      it('has no patient data at all: totals only', async () => {
        const res = await get(
          R,
          'adminMain',
          `/opd/reports/daily-collection.csv?date=${today}`,
        ).buffer(true);
        expect(res.text).not.toMatch(/Secret Name|RP[A-Z0-9]*UH|uhid/i);
        const json = JSON.stringify((await report(R, 'adminMain', today)).body);
        expect(json).not.toMatch(/Secret Name/);
      });

      it('is Admin only and rejects a bad date like the report does', async () => {
        expect(
          (await get(R, 'recvMain', `/opd/reports/daily-collection.csv?date=${today}`)).status,
        ).toBe(403);
        expect(
          (await get(R, 'adminMain', '/opd/reports/daily-collection.csv?date=nope')).status,
        ).toBe(400);
      });
    });
  });

  // ============================================================== refunds land on their own day

  describe('which day a payment and a refund belong to', () => {
    it('a refund counts on the day it was approved, never on the day of the bill', async () => {
      const D = await seedHospital('D');
      const book = newBook();
      const today = dayIn('Asia/Kolkata');
      const yesterday = addDays(today, -1);
      const v = await visit(D, 'recvMain', D.doc1, book);
      await refund(D, v.billId, 20_000, book, D.doc1, 'CASH');
      // the payment was taken yesterday; the refund is today
      const payment = await owner.payment.findFirstOrThrow({ where: { billId: v.billId } });
      await backdate(payment.id, 1);

      const before = await report(D, 'adminMain', yesterday);
      expect(before.body.totals).toMatchObject({
        collectedPaise: v.total,
        refundedPaise: 0,
        netPaise: v.total,
        payments: 1,
        refunds: 0,
      });
      const now = await report(D, 'adminMain', today);
      expect(now.body.totals).toMatchObject({
        collectedPaise: 0,
        refundedPaise: 20_000,
        netPaise: -20_000,
        payments: 0,
        refunds: 1,
      });
      // a negative net is shown as a negative number in the file
      const csv = await get(
        D,
        'adminMain',
        `/opd/reports/daily-collection.csv?date=${today}`,
      ).buffer(true);
      expect(csv.text).toContain(',0.00,200.00,-200.00,');
      // both days still agree with the ledger
      expect(before.body.ledger.matches).toBe(true);
      expect(now.body.ledger.matches).toBe(true);
    });

    it('the day is the hospital time zone day, not the server day', async () => {
      const Z = await seedHospital('Z');
      const book = newBook();
      const v = await visit(Z, 'recvMain', Z.doc1, book);
      for (const tz of ['Pacific/Pago_Pago', 'Asia/Kolkata', 'Pacific/Kiritimati', 'UTC']) {
        await owner.opdSettings.update({ where: { tenantId: Z.tenant }, data: { timezone: tz } });
        const paidDay = dayIn(tz);
        const inside = await report(Z, 'adminMain', paidDay);
        expect({ tz, status: inside.status }).toEqual({ tz, status: 200 });
        expect({ tz, collected: inside.body.totals.collectedPaise }).toEqual({
          tz,
          collected: v.total,
        });
        expect(inside.body.timezone).toBe(tz);
        // the day before, in that same time zone, has nothing
        const outside = await report(Z, 'adminMain', addDays(paidDay, -1));
        expect({ tz, collected: outside.body.totals.collectedPaise }).toEqual({ tz, collected: 0 });
      }
    });

    it('a day that has not started yet in the hospital time zone is refused', async () => {
      const Y = await seedHospital('Y', 'Pacific/Pago_Pago');
      const tomorrowThere = addDays(dayIn('Pacific/Pago_Pago'), 1);
      const res = await report(Y, 'adminMain', tomorrowThere);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('REPORT_DATE_INVALID');
      // but "today" of a time zone far ahead of this one is a real day there
      await owner.opdSettings.update({
        where: { tenantId: Y.tenant },
        data: { timezone: 'Pacific/Kiritimati' },
      });
      expect((await report(Y, 'adminMain', dayIn('Pacific/Kiritimati'))).status).toBe(200);
    });
  });

  // ================================================================== branches and hospitals

  describe('branches and hospitals', () => {
    it('one branch by default, all branches only with hospital-wide access', async () => {
      const H = await seedHospital('H');
      const bookMain = newBook();
      const bookEast = newBook();
      const today = dayIn('Asia/Kolkata');
      await visit(H, 'recvMain', H.doc1, bookMain);
      await visit(H, 'recvMain', H.doc1, bookMain);
      // an east visit: the east receptionist, whose token is the east branch
      await visit(H, 'recvEast', H.doc2, bookEast, 'split');

      const main = await report(H, 'adminMain', today);
      expect(main.body.totals.collectedPaise).toBe(sum(bookMain.paid));
      expect(main.body.branches.map((b: Loose) => b.code)).toEqual(['MAIN']);
      const east = await report(H, 'adminEast', today);
      expect(east.body.totals.collectedPaise).toBe(sum(bookEast.paid));
      expect(east.body.branches.map((b: Loose) => b.code)).toEqual(['EAST']);
      expect(east.body.byMode.map((m: Loose) => m.key).sort()).toEqual(['CASH', 'UPI']);

      // a branch Admin cannot ask for all branches (one branch of two is not hospital-wide)
      for (const who of ['adminMain', 'adminEast']) {
        const denied = await report(H, who, today, '&branch=ALL');
        expect({ who, status: denied.status }).toEqual({ who, status: 403 });
        expect(denied.body.code).toBe('REPORT_SCOPE_FORBIDDEN');
      }
      // hospital-wide access combines them, with a row per branch
      const all = await report(H, 'superAdmin', today, '&branch=ALL');
      expect(all.status).toBe(200);
      expect(all.body.combined).toBe(true);
      expect(all.body.branches.map((b: Loose) => b.code).sort()).toEqual(['EAST', 'MAIN']);
      expect(all.body.totals.collectedPaise).toBe(sum(bookMain.paid) + sum(bookEast.paid));
      expect(
        Object.fromEntries(all.body.byBranch.map((r: Loose) => [r.key, r.collectedPaise])),
      ).toEqual({ MAIN: sum(bookMain.paid), EAST: sum(bookEast.paid) });
      expect(Object.fromEntries(all.body.byBranch.map((r: Loose) => [r.key, r.visits]))).toEqual({
        MAIN: 2,
        EAST: 1,
      });
      expect(all.body.counts.visits).toBe(3);
      expect(all.body.ledger.matches).toBe(true);
      const csv = await get(
        H,
        'superAdmin',
        `/opd/reports/daily-collection.csv?date=${today}&branch=ALL`,
      ).buffer(true);
      expect(csv.headers['content-disposition']).toBe(
        `attachment; filename="collection-${today}-all.csv"`,
      );
      expect(csv.text.split('\r\n').filter((r) => r.includes(',BRANCH,'))).toHaveLength(2);
      // the same hospital-wide person without ALL still gets only the branch they are working in
      const own = await report(H, 'superAdmin', today);
      expect(own.body.totals.collectedPaise).toBe(sum(bookMain.paid));
      expect(own.body.combined).toBe(false);
    });

    it('another hospital sees none of it, and "all" never reaches across hospitals', async () => {
      const P = await seedHospital('P');
      const Q = await seedHospital('Q');
      const bookP = newBook();
      const today = dayIn('Asia/Kolkata');
      await visit(P, 'recvMain', P.doc1, bookP);
      const q = await report(Q, 'adminMain', today);
      expect(q.body.totals.collectedPaise).toBe(0);
      const qAll = await report(Q, 'superAdmin', today, '&branch=ALL');
      expect(qAll.body.totals.collectedPaise).toBe(0);
      expect(qAll.body.branches.every((b: Loose) => b.id === Q.main || b.id === Q.east)).toBe(true);
      const p = await report(P, 'superAdmin', today, '&branch=ALL');
      expect(p.body.totals.collectedPaise).toBe(sum(bookP.paid));
    });

    it('an Admin whose access was switched off gets nothing, and a hospital without the module is refused', async () => {
      const M = await seedHospital('M');
      const today = dayIn('Asia/Kolkata');
      await owner.branchModule.updateMany({
        where: { tenantId: M.tenant, branchId: M.east },
        data: { restrictedByHospital: true },
      });
      // the east branch has the OPD module restricted: "all" leaves it out, never errors
      const all = await report(M, 'superAdmin', today, '&branch=ALL');
      expect(all.status).toBe(200);
      expect(all.body.branches.map((b: Loose) => b.code)).toEqual(['MAIN']);
      await owner.branchModule.updateMany({
        where: { tenantId: M.tenant },
        data: { restrictedByHospital: true },
      });
      expect((await report(M, 'adminMain', today)).status).toBe(403);
      expect((await report(M, 'superAdmin', today, '&branch=ALL')).status).toBe(403);
    });
  });

  // ====================================================================== the ledger check

  describe('the ledger check', () => {
    it('says so if the books ever disagree (a ledger refund with no refund row behind it)', async () => {
      const L = await seedHospital('L');
      const book = newBook();
      const today = dayIn('Asia/Kolkata');
      const v = await visit(L, 'recvMain', L.doc1, book);
      expect((await report(L, 'adminMain', today)).body.ledger.matches).toBe(true);
      // a one-paise REFUND written straight into the ledger (never possible through the API)
      await owner.ledgerEntry.create({
        data: {
          tenantId: L.tenant,
          billId: v.billId,
          branchId: L.main,
          entryType: 'REFUND',
          amountPaise: 1,
        },
      });
      const res = await report(L, 'adminMain', today);
      expect(res.status).toBe(200);
      expect(res.body.ledger).toEqual({
        paymentPaise: v.total,
        refundPaise: 1,
        matches: false,
      });
      // the report itself still shows what the payment and refund tables say
      expect(res.body.totals.refundedPaise).toBe(0);
    });
  });
});
