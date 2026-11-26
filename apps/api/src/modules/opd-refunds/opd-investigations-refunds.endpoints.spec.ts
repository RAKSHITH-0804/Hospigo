import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CLOCK, FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for OPD tests and refund tests`);
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
const NURSE_PERMS = [
  'opd.masters.read',
  'opd.visits.read',
  'opd.queue.read',
  'opd.vitals.read',
  'opd.vitals.write',
  'opd.notes.read',
] as const;
const DOCTOR_PERMS = [...NURSE_PERMS, 'opd.notes.write', 'opd.investigations.order'] as const;
const RECEPTION_PERMS = [
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'opd.queue.read',
  'patients.registry.read',
  'opd.investigations.bill',
  'opd.refunds.request',
] as const;
const ADMIN_PERMS = ['opd.visits.read', 'opd.billing.read', 'opd.refunds.approve'] as const;
/** Deliberately BOTH: the asker must still never decide their own request. */
const BOTH_PERMS = [
  'opd.visits.read',
  'opd.billing.read',
  'opd.refunds.request',
  'opd.refunds.approve',
] as const;
const NO_COLLECT_PERMS = [
  'opd.visits.read',
  'opd.billing.read',
  'opd.investigations.bill',
  'opd.refunds.request',
] as const;
const ALL_CODES = [
  ...new Set([
    ...DOCTOR_PERMS,
    ...RECEPTION_PERMS,
    ...ADMIN_PERMS,
    ...BOTH_PERMS,
    ...NO_COLLECT_PERMS,
  ]),
];

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
  items: { a: string; b: string; noPrice: string; off: string; reg: string; free: string };
  tokens: Record<string, string>;
  users: Record<string, string>;
};

describe('OPD tests ordering, investigations bill, refunds and cancellation (HTTP)', () => {
  jest.setTimeout(180_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}-${stamp}-${(seq += 1)}`;
  let A: Hospital;
  let B: Hospital;
  /** A hospital WITHOUT a REFUND number series (never configured). */
  let C: Hospital;

  async function seedHospital(label: string, withRefundSeries = true): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `IR_${label}_${stamp}`,
        name: `InvRefund ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `ir-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `ir-${label}-e-${stamp}` },
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
      data: { tenantId: tenant, followUpFreeDays: 7, tokenPrefix: 'T', timezone: 'Asia/Kolkata' },
    });
    for (const series of (withRefundSeries
      ? ['BILL', 'RECEIPT', 'REFUND']
      : ['BILL', 'RECEIPT']) as Array<'BILL' | 'RECEIPT' | 'REFUND'>) {
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
        email: `ir_s_${label}_${stamp}@example.test`,
        displayName: 'Setup',
        passwordHash: 'x',
      },
    });
    const item = async (
      code: string,
      name: string,
      kind: 'REGISTRATION' | 'INVESTIGATION',
      price: number | null,
      active = true,
    ) => {
      const row = await owner.chargeItem.create({
        data: { tenantId: tenant, code, name, kind, active },
      });
      if (price !== null) {
        await owner.chargeItemPrice.create({
          data: {
            tenantId: tenant,
            chargeItemId: row.id,
            amountPaise: price,
            effectiveFrom: new Date('2020-01-01'),
            createdBy: staff.id,
          },
        });
      }
      return row.id;
    };
    const items = {
      reg: await item('REG', 'Registration', 'REGISTRATION', 10_000),
      a: await item('INVA', 'Blood test A', 'INVESTIGATION', 30_000),
      b: await item('INVB', 'Scan B', 'INVESTIGATION', 20_000),
      noPrice: await item('INVC', 'No price C', 'INVESTIGATION', null),
      off: await item('INVOFF', 'Old test', 'INVESTIGATION', 5_000, false),
      free: await item('INVZ', 'Free test', 'INVESTIGATION', 0),
    };

    const perms = await owner.permission.findMany({ where: { code: { in: ALL_CODES } } });
    if (perms.length !== ALL_CODES.length) {
      throw new Error('6a permissions missing from the test catalog (re-run the reference seed)');
    }
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    async function makeUser(key: string, codes: readonly string[], branches: string[]) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `ir_${key}_${label}_${stamp}@example.test`,
          displayName: `Person ${key} ${label}`,
          passwordHash: 'x',
        },
      });
      for (const branchId of branches) {
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
          data: { tenantId: tenant, userId: u.id, roleId: role.id, scopeType: 'BRANCH' },
        });
        for (const branchId of branches) {
          await owner.roleAssignmentBranch.create({
            data: { tenantId: tenant, assignmentId: assignment.id, branchId },
          });
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
    await makeUser('recv', RECEPTION_PERMS, [main]);
    await makeUser('recv2', RECEPTION_PERMS, [main]);
    await makeUser('recvNoCollect', NO_COLLECT_PERMS, [main]);
    await makeUser('admin', ADMIN_PERMS, [main]);
    await makeUser('admin2', ADMIN_PERMS, [main]);
    await makeUser('adminEast', ADMIN_PERMS, [east]);
    await makeUser('both', BOTH_PERMS, [main]);
    await makeUser('nurse', NURSE_PERMS, [main]);
    await makeUser('docNoProfile', DOCTOR_PERMS, [main]);
    await makeUser('nobody', [], [main]);
    async function makeDoctor(key: string) {
      const u = await makeUser(key, DOCTOR_PERMS, [main]);
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
    const doc1 = await makeDoctor('doc1');
    const doc2 = await makeDoctor('doc2');
    return { tenant, main, east, user: staff.id, doc1, doc2, items, tokens, users };
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
    A = await seedHospital('A');
    B = await seedHospital('B');
    C = await seedHospital('C', false);
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

  let patientCounter = 0;
  async function newPatient(h: Hospital): Promise<string> {
    patientCounter += 1;
    const p = await owner.patient.create({
      data: {
        tenantId: h.tenant,
        uhid: `IR${h.tenant.slice(-6)}${stamp}${patientCounter}`,
        registeredBranchId: h.main,
        name: `Secret Name ${patientCounter}`,
        gender: 'F',
        createdBy: h.user,
      },
    });
    return p.id;
  }

  /** A paid, queued visit made through the real reception API (new patient: fee 500 + registration 100). */
  async function waiting(
    h: Hospital,
    doctor: string = h.doc1,
    patientId?: string,
    visitType: 'NEW' | 'FOLLOW_UP' = 'NEW',
  ): Promise<{ id: string; billId: string; totalPaise: number }> {
    const res = await post(h, 'recv', '/opd/visits', {
      patientId: patientId ?? (await newPatient(h)),
      doctorProfileId: doctor,
      visitType,
      idempotencyKey: uniq('KEY-IR'),
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('WAITING');
    return { id: res.body.id, billId: res.body.bill.id, totalPaise: res.body.bill.totalPaise };
  }
  const start = (h: Hospital, who: string, id: string) => post(h, who, `/opd/visits/${id}/start`);
  /** Visit in consultation (the doctor started it). */
  async function consulting(h: Hospital, who = 'doc1', doctor: string = h.doc1) {
    const v = await waiting(h, doctor);
    expect((await start(h, who, v.id)).status).toBe(200);
    return v;
  }
  async function finish(h: Hospital, who: string, id: string) {
    expect(
      (await put(h, who, `/opd/visits/${id}/consultation`, { complaints: 'cough' })).status,
    ).toBe(200);
    expect((await post(h, who, `/opd/visits/${id}/complete`)).status).toBe(200);
  }
  const order = (h: Hospital, who: string, id: string, ids: string[]) =>
    put(h, who, `/opd/visits/${id}/investigations`, { chargeItemIds: ids });
  /** The order ids of a visit by test code. */
  async function orderIds(h: Hospital, id: string): Promise<Record<string, string>> {
    const res = await get(h, 'recv', `/opd/visits/${id}/investigations`);
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.orders.map((o: Loose) => [o.code, o.id]));
  }
  const billTests = (h: Hospital, who: string, id: string, body: object) =>
    post(h, who, `/opd/visits/${id}/investigation-bills`, body);
  const reqRefund = (h: Hospital, who: string, billId: string, amountPaise: number, extra = {}) =>
    post(h, who, `/opd/bills/${billId}/refund-requests`, {
      amountPaise,
      reason: 'Wrong bill',
      idempotencyKey: uniq('KEY-RF'),
      ...extra,
    });
  const reqCancel = (h: Hospital, who: string, visitId: string, extra = {}) =>
    post(h, who, `/opd/visits/${visitId}/cancel-requests`, {
      reason: 'Patient left',
      idempotencyKey: uniq('KEY-CX'),
      ...extra,
    });
  const approve = (h: Hospital, who: string, id: string, body: object = {}) =>
    post(h, who, `/opd/refund-requests/${id}/approve`, body);
  const reject = (h: Hospital, who: string, id: string, body: object = { note: 'Not valid' }) =>
    post(h, who, `/opd/refund-requests/${id}/reject`, body);
  const auditRows = (h: Hospital, action: string, entityId?: string) =>
    owner.auditLog.findMany({
      where: { tenantId: h.tenant, action, ...(entityId ? { entityId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  const refundsOf = (requestId: string) => owner.refund.findMany({ where: { requestId } });

  /** Consultation in progress, two tests ordered and billed in cash: returns the tests bill. */
  async function paidTests(h: Hospital, split = false) {
    const v = await consulting(h);
    expect((await order(h, 'doc1', v.id, [h.items.a, h.items.b])).status).toBe(200);
    const ids = await orderIds(h, v.id);
    const res = await billTests(h, 'recv', v.id, {
      idempotencyKey: uniq('KEY-TB'),
      orderIds: [ids.INVA, ids.INVB],
      ...(split
        ? {
            payments: [
              { paymentModeCode: 'UPI', amountPaise: 30_000, referenceNo: 'U-1' },
              { paymentModeCode: 'CASH', amountPaise: 20_000 },
            ],
          }
        : {}),
    });
    expect(res.status).toBe(201);
    return { visit: v, billId: res.body.bill.id as string, ids, res };
  }

  // -------------------------------------------------------------------------------- access

  describe('access', () => {
    const routes: Array<[string, string]> = [
      ['get', '/opd/investigations/tests'],
      ['get', '/opd/investigations/pending'],
      ['put', '/opd/visits/x/investigations'],
      ['get', '/opd/visits/x/investigations'],
      ['post', '/opd/visits/x/investigation-bills'],
      ['post', '/opd/bills/x/refund-requests'],
      ['post', '/opd/visits/x/cancel-requests'],
      ['get', '/opd/refund-requests'],
      ['get', '/opd/refund-requests/x'],
      ['post', '/opd/refund-requests/x/approve'],
      ['post', '/opd/refund-requests/x/reject'],
    ];
    const call = (method: string, url: string, headers: Record<string, string> = {}) =>
      (http() as Loose)[method](url).set(headers).send({});

    it('401 without a token or with a patient token', async () => {
      const patientToken = tokenService.signPatientAccess({ accountId: 'acc' });
      for (const [method, url] of routes) {
        expect((await call(method, url)).status).toBe(401);
        expect((await call(method, url, { Authorization: `Bearer ${patientToken}` })).status).toBe(
          401,
        );
      }
    });

    it('403 for staff without the permission of each route (deny by default)', async () => {
      const allowed: Record<string, string[]> = {
        // route -> staff who MAY pass the permission guard (everyone else gets 403)
        '/opd/investigations/tests': ['doc1', 'nurse', 'docNoProfile'],
        '/opd/investigations/pending': ['recv', 'recvNoCollect'],
        '/opd/visits/x/investigations:put': ['doc1', 'docNoProfile'],
        // (the route guard passes visits.read, then the service wants the order or bill permission)
        '/opd/visits/x/investigations:get': ['doc1', 'recv', 'recvNoCollect'],
        '/opd/visits/x/investigation-bills': ['recv', 'recvNoCollect'],
        '/opd/bills/x/refund-requests': ['recv', 'recv2', 'recvNoCollect', 'both'],
        '/opd/visits/x/cancel-requests': ['recv', 'recv2', 'recvNoCollect', 'both'],
        '/opd/refund-requests': ['recv', 'recvNoCollect', 'admin', 'admin2', 'both'],
        '/opd/refund-requests/x': ['recv', 'recvNoCollect', 'admin', 'admin2', 'both'],
        '/opd/refund-requests/x/approve': ['admin', 'admin2', 'both'],
        '/opd/refund-requests/x/reject': ['admin', 'admin2', 'both'],
      };
      const everyone = [
        'nobody',
        'nurse',
        'recv',
        'recvNoCollect',
        'admin',
        'both',
        'doc1',
        'docNoProfile',
      ];
      for (const [method, url] of routes) {
        const key = method === 'put' || url.endsWith('/investigations') ? `${url}:${method}` : url;
        const ok = allowed[key] ?? allowed[url];
        expect({ url, ok: !!ok }).toEqual({ url, ok: true });
        for (const who of everyone) {
          const res = await call(method, url, as(A, who));
          if (ok!.includes(who)) {
            expect({ who, url, forbidden: res.status === 403 }).toEqual({
              who,
              url,
              forbidden: false,
            });
          } else {
            expect({ who, url, status: res.status }).toEqual({ who, url, status: 403 });
          }
        }
      }
    });

    it('the admin roles seed: approval for admins; request, billing and ordering never', async () => {
      const { ADMIN_EXCLUDED_PERMISSION_CODES } = await import('../../../prisma/seeds/reference');
      for (const code of [
        'opd.investigations.order',
        'opd.investigations.bill',
        'opd.refunds.request',
      ]) {
        expect(ADMIN_EXCLUDED_PERMISSION_CODES).toContain(code);
      }
      expect(ADMIN_EXCLUDED_PERMISSION_CODES).not.toContain('opd.refunds.approve');
    });
  });

  // ---------------------------------------------------------------------- doctor orders

  describe('doctor orders tests', () => {
    it('searches the active tests list without prices', async () => {
      const res = await get(A, 'doc1', '/opd/investigations/tests?q=test');
      expect(res.status).toBe(200);
      const codes = res.body.items.map((i: Loose) => i.code);
      expect(codes).toEqual(expect.arrayContaining(['INVA']));
      expect(codes).not.toContain('INVOFF');
      expect(codes).not.toContain('REG');
      expect(JSON.stringify(res.body)).not.toMatch(/price|paise/i);
      // hospital B's doctor searches B's own list only
      const other = await get(B, 'doc1', '/opd/investigations/tests?q=test');
      expect(other.status).toBe(200);
      const idsB = other.body.items.map((i: Loose) => i.id);
      expect(idsB).toContain(B.items.a);
      expect(idsB).not.toContain(A.items.a);
    });

    it('orders two tests while in consultation; replaces the list; names are copied', async () => {
      const v = await consulting(A);
      const first = await order(A, 'doc1', v.id, [A.items.a, A.items.b]);
      expect(first.status).toBe(200);
      expect(first.body.orders.map((o: Loose) => [o.code, o.name, o.status])).toEqual([
        ['INVA', 'Blood test A', 'ORDERED'],
        ['INVB', 'Scan B', 'ORDERED'],
      ]);
      // the doctor changes their mind: only B stays, A is removed
      const second = await order(A, 'doc1', v.id, [A.items.b]);
      expect(second.body.orders.map((o: Loose) => o.code)).toEqual(['INVB']);
      // same list again changes nothing
      const third = await order(A, 'doc1', v.id, [A.items.b]);
      expect(third.body.orders).toHaveLength(1);
      // an empty list clears the ORDERED tests
      const cleared = await order(A, 'doc1', v.id, []);
      expect(cleared.body.orders).toEqual([]);
      expect((await auditRows(A, 'OPD_INVESTIGATION_ORDER', v.id)).length).toBeGreaterThanOrEqual(
        3,
      );
      const audit = JSON.stringify(
        (await auditRows(A, 'OPD_INVESTIGATION_ORDER', v.id)).map((r) => r.metadata),
      );
      expect(audit).not.toMatch(/Blood|Scan|INVA|INVB/);
    });

    it('refuses unknown, inactive, non-test and duplicate items, and too many tests', async () => {
      const v = await consulting(A);
      expect((await order(A, 'doc1', v.id, ['nope'])).status).toBe(404);
      expect((await order(A, 'doc1', v.id, [A.items.off])).status).toBe(404);
      expect((await order(A, 'doc1', v.id, [A.items.reg])).status).toBe(404);
      // hospital B's doctor cannot touch hospital A's visit (not found, never a hint)
      expect((await order(B, 'doc1', v.id, [B.items.a])).status).toBe(404);
      const dup = await order(A, 'doc1', v.id, [A.items.a, A.items.a]);
      expect(dup.status).toBe(400);
      expect(dup.body.code).toBe('TEST_DUPLICATE');
      const many = await order(
        A,
        'doc1',
        v.id,
        Array.from({ length: 31 }, (_, i) => `id${i}`),
      );
      expect(many.status).toBe(400);
      expect(await owner.investigationOrder.count({ where: { visitId: v.id } })).toBe(0);
      // another hospital's test id never resolves in this hospital
      const foreign = await order(A, 'doc1', v.id, [B.items.a]);
      expect(foreign.status).toBe(404);
    });

    it('only the assigned doctor, only while in consultation', async () => {
      const v = await waiting(A);
      // waiting: not started yet
      const early = await order(A, 'doc1', v.id, [A.items.a]);
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('VISIT_NOT_IN_CONSULTATION');
      expect((await start(A, 'doc1', v.id)).status).toBe(200);
      // another doctor: the visit is "not found"; no profile: 403; nurse: 403
      expect((await order(A, 'doc2', v.id, [A.items.a])).status).toBe(404);
      const noProfile = await order(A, 'docNoProfile', v.id, [A.items.a]);
      expect(noProfile.status).toBe(403);
      expect(noProfile.body.code).toBe('DOCTOR_PROFILE_REQUIRED');
      expect((await order(A, 'nurse', v.id, [A.items.a])).status).toBe(403);
      expect((await order(A, 'doc1', v.id, [A.items.a])).status).toBe(200);
      // after completing: closed
      await finish(A, 'doc1', v.id);
      const late = await order(A, 'doc1', v.id, [A.items.b]);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('VISIT_NOT_IN_CONSULTATION');
      expect(await owner.investigationOrder.count({ where: { visitId: v.id } })).toBe(1);
    });

    it('a doctor reads their own visit only; reception sees the tests and bills; a nurse is refused', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a]);
      const own = await get(A, 'doc1', `/opd/visits/${v.id}/investigations`);
      expect(own.status).toBe(200);
      expect(own.body.orders).toHaveLength(1);
      expect(own.body.bills).toBeUndefined(); // a doctor never sees money
      expect((await get(A, 'doc2', `/opd/visits/${v.id}/investigations`)).status).toBe(404);
      expect((await get(A, 'nurse', `/opd/visits/${v.id}/investigations`)).status).toBe(403);
      const recv = await get(A, 'recv', `/opd/visits/${v.id}/investigations`);
      expect(recv.status).toBe(200);
      expect(recv.body.bills).toEqual([]);
    });
  });

  // --------------------------------------------------------------------- reception bills

  describe('pending list and the investigations bill', () => {
    it('lists the pending tests with current prices and the total; no price shows null', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a, A.items.b, A.items.noPrice]);
      const res = await get(A, 'recv', '/opd/investigations/pending');
      expect(res.status).toBe(200);
      const row = res.body.items.find((i: Loose) => i.visitId === v.id);
      expect(row.visitStatus).toBe('IN_CONSULTATION');
      expect(row.patient.name).toMatch(/Secret Name/);
      expect(row.orders.map((o: Loose) => [o.code, o.pricePaise])).toEqual([
        ['INVA', 30_000],
        ['INVB', 20_000],
        ['INVC', null],
      ]);
      expect(row.totalPaise).toBe(50_000);
      // another hospital sees none of it
      const other = await get(B, 'recv', '/opd/investigations/pending');
      expect(other.body.items.find((i: Loose) => i.visitId === v.id)).toBeUndefined();
    });

    it('bills the chosen tests: bill, lines, ONE receipt, payment, ledger, orders become BILLED', async () => {
      const { visit, billId, res, ids } = await paidTests(A);
      expect(res.body.replayed).toBe(false);
      expect(res.body.bill).toMatchObject({
        billType: 'INVESTIGATION',
        totalPaise: 50_000,
        paidPaise: 50_000,
        refundedPaise: 0,
        paymentStatus: 'PAID',
      });
      expect(res.body.bill.lines.map((l: Loose) => [l.kind, l.code, l.unitPricePaise])).toEqual([
        ['INVESTIGATION', 'INVA', 30_000],
        ['INVESTIGATION', 'INVB', 20_000],
      ]);
      expect(res.body.bill.receipts).toHaveLength(1);
      expect(res.body.orders.every((o: Loose) => o.status === 'BILLED')).toBe(true);
      expect(res.body.orders[0].billNumber).toBe(res.body.bill.billNumber);
      const ledger = await owner.ledgerEntry.findMany({ where: { billId } });
      expect(ledger.map((l) => l.entryType).sort()).toEqual(['CHARGE', 'PAYMENT']);
      // not pending any more
      const pending = await get(A, 'recv', '/opd/investigations/pending');
      expect(pending.body.items.find((i: Loose) => i.visitId === visit.id)).toBeUndefined();
      // the doctor view of the visit never carries money; reception sees the bill
      const rv = await get(A, 'recv', `/opd/visits/${visit.id}/investigations`);
      expect(rv.body.bills).toHaveLength(1);
      expect(ids.INVA).toBeTruthy();
      // the consultation view of the visit still shows the CONSULTATION bill
      const vv = await get(A, 'recv', `/opd/visits/${visit.id}`);
      expect(vv.body.bill.billType).toBe('CONSULTATION');
    });

    it('split payment: UPI + cash on one bill, one receipt; wrong sums and missing reference are refused', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a, A.items.b]);
      const ids = await orderIds(A, v.id);
      const body = (payments: object[]) => ({
        idempotencyKey: uniq('KEY-SP'),
        orderIds: [ids.INVA, ids.INVB],
        payments,
      });
      const short = await billTests(
        A,
        'recv',
        v.id,
        body([{ paymentModeCode: 'CASH', amountPaise: 49_999 }]),
      );
      expect(short.status).toBe(400);
      expect(short.body.code).toBe('PAYMENT_SUM_MISMATCH');
      const noRef = await billTests(
        A,
        'recv',
        v.id,
        body([
          { paymentModeCode: 'UPI', amountPaise: 30_000 },
          { paymentModeCode: 'CASH', amountPaise: 20_000 },
        ]),
      );
      expect(noRef.status).toBe(400);
      expect(noRef.body.code).toBe('REFERENCE_REQUIRED');
      const twice = await billTests(
        A,
        'recv',
        v.id,
        body([
          { paymentModeCode: 'CASH', amountPaise: 25_000 },
          { paymentModeCode: 'CASH', amountPaise: 25_000 },
        ]),
      );
      expect(twice.body.code).toBe('PAYMENT_MODE_DUPLICATE');
      // nothing was written by any refusal
      expect(await owner.bill.count({ where: { visitId: v.id, billType: 'INVESTIGATION' } })).toBe(
        0,
      );
      const ok = await billTests(
        A,
        'recv',
        v.id,
        body([
          { paymentModeCode: 'UPI', amountPaise: 30_000, referenceNo: 'U-9' },
          { paymentModeCode: 'CASH', amountPaise: 20_000 },
        ]),
      );
      expect(ok.status).toBe(201);
      expect(ok.body.bill.receipts).toHaveLength(1);
      expect(ok.body.bill.payments).toHaveLength(2);
      expect(ok.body.bill.payments[0].receiptNumber).toBe(ok.body.bill.payments[1].receiptNumber);
    });

    it('the same key again returns the same bill (200); the same key for something else is refused', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a, A.items.b]);
      const ids = await orderIds(A, v.id);
      const key = uniq('KEY-RP');
      const body = { idempotencyKey: key, orderIds: [ids.INVA, ids.INVB] };
      const first = await billTests(A, 'recv', v.id, body);
      expect(first.status).toBe(201);
      const again = await billTests(A, 'recv', v.id, body);
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.bill.id).toBe(first.body.bill.id);
      expect(again.body.bill.receipts[0].receiptNumber).toBe(
        first.body.bill.receipts[0].receiptNumber,
      );
      const other = await billTests(A, 'recv', v.id, { idempotencyKey: key, orderIds: [ids.INVA] });
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherPay = await billTests(A, 'recv', v.id, {
        ...body,
        paymentModeCode: 'UPI',
        referenceNo: 'x',
      });
      expect(otherPay.status).toBe(409);
      // the key of a visit's bill cannot be replayed on another visit
      const v2 = await consulting(A);
      const wrongVisit = await billTests(A, 'recv', v2.id, body);
      expect(wrongVisit.status).toBe(409);
      expect(await owner.bill.count({ where: { idempotencyKey: key } })).toBe(1);
    });

    it('two clicks at the same moment: one bill, both callers get it', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a]);
      const ids = await orderIds(A, v.id);
      const body = { idempotencyKey: uniq('KEY-DC'), orderIds: [ids.INVA] };
      const [r1, r2] = await Promise.all([
        billTests(A, 'recv', v.id, body),
        billTests(A, 'recv', v.id, body),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 201]);
      expect(r1.body.bill.id).toBe(r2.body.bill.id);
      expect(await owner.bill.count({ where: { visitId: v.id, billType: 'INVESTIGATION' } })).toBe(
        1,
      );
      expect(await owner.receipt.count({ where: { billId: r1.body.bill.id } })).toBe(1);
    });

    it('two receptionists billing the same test with different keys: exactly one wins', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a]);
      const ids = await orderIds(A, v.id);
      const [r1, r2] = await Promise.all([
        billTests(A, 'recv', v.id, { idempotencyKey: uniq('KEY-R1'), orderIds: [ids.INVA] }),
        billTests(A, 'recv2', v.id, { idempotencyKey: uniq('KEY-R2'), orderIds: [ids.INVA] }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      expect(loser.body.code).toBe('ORDERS_NOT_AVAILABLE');
      expect(await owner.bill.count({ where: { visitId: v.id, billType: 'INVESTIGATION' } })).toBe(
        1,
      );
      expect(
        await owner.investigationOrder.count({ where: { visitId: v.id, status: 'BILLED' } }),
      ).toBe(1);
    });

    it('a test the patient declines is marked not taken with a reason and never billed', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a, A.items.b]);
      const ids = await orderIds(A, v.id);
      const res = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-NT'),
        orderIds: [ids.INVA],
        notTaken: [{ orderId: ids.INVB, reason: 'Done elsewhere' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.bill.totalPaise).toBe(30_000);
      expect(res.body.bill.lines).toHaveLength(1);
      const byCode = Object.fromEntries(res.body.orders.map((o: Loose) => [o.code, o]));
      expect(byCode.INVB).toMatchObject({ status: 'NOT_TAKEN', notTakenReason: 'Done elsewhere' });
      // neither can be billed again
      const again = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-NT2'),
        orderIds: [ids.INVB],
      });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ORDERS_NOT_AVAILABLE');
      // an empty reason is refused
      const v2 = await consulting(A);
      await order(A, 'doc1', v2.id, [A.items.a, A.items.b]);
      const ids2 = await orderIds(A, v2.id);
      const bad = await billTests(A, 'recv', v2.id, {
        idempotencyKey: uniq('KEY-NT3'),
        orderIds: [ids2.INVA],
        notTaken: [{ orderId: ids2.INVB, reason: '' }],
      });
      expect(bad.status).toBe(400);
      // the same test both taken and declined is refused
      const both = await billTests(A, 'recv', v2.id, {
        idempotencyKey: uniq('KEY-NT4'),
        orderIds: [ids2.INVA],
        notTaken: [{ orderId: ids2.INVA, reason: 'x' }],
      });
      expect(both.status).toBe(400);
      expect(both.body.code).toBe('TEST_DUPLICATE');
      expect(
        await owner.investigationOrder.count({ where: { visitId: v2.id, status: 'ORDERED' } }),
      ).toBe(2);
      expect(await auditRows(A, 'OPD_INVESTIGATION_NOT_TAKEN')).not.toHaveLength(0);
    });

    it('refuses a changed total, a test without a price, and ids of another visit or hospital', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a, A.items.noPrice]);
      const ids = await orderIds(A, v.id);
      const changed = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-PC'),
        orderIds: [ids.INVA],
        expectedTotalPaise: 29_999,
      });
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('PRICE_CHANGED');
      const noPrice = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-NP'),
        orderIds: [ids.INVC],
      });
      expect(noPrice.status).toBe(409);
      expect(noPrice.body.code).toBe('FEE_NOT_CONFIGURED');
      const v2 = await consulting(A);
      await order(A, 'doc1', v2.id, [A.items.a]);
      const ids2 = await orderIds(A, v2.id);
      // an order of ANOTHER visit under this visit's URL
      const cross = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-XV'),
        orderIds: [ids2.INVA],
      });
      expect(cross.status).toBe(409);
      expect(cross.body.code).toBe('ORDERS_NOT_AVAILABLE');
      // an order of another HOSPITAL
      const vb = await consulting(B, 'doc1', B.doc1);
      await order(B, 'doc1', vb.id, [B.items.a]);
      const idsB = await orderIds(B, vb.id);
      const foreign = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-XH'),
        orderIds: [idsB.INVA],
      });
      expect(foreign.status).toBe(409);
      expect(await owner.bill.count({ where: { visitId: v.id, billType: 'INVESTIGATION' } })).toBe(
        0,
      );
      expect(
        await owner.investigationOrder.count({ where: { visitId: v.id, status: 'ORDERED' } }),
      ).toBe(2);
    });

    it('a waiting visit cannot be billed; a completed visit can; another branch or hospital sees nothing', async () => {
      const w = await waiting(A);
      const waitingTry = await billTests(A, 'recv', w.id, {
        idempotencyKey: uniq('KEY-WT'),
        orderIds: ['x'],
      });
      expect(waitingTry.status).toBe(409);
      expect(waitingTry.body.code).toBe('VISIT_NOT_BILLABLE');
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.b]);
      await finish(A, 'doc1', v.id);
      const ids = await orderIds(A, v.id);
      const late = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-LT'),
        orderIds: [ids.INVB],
      });
      expect(late.status).toBe(201);
      expect(late.body.bill.paymentStatus).toBe('PAID');
      // a token of another hospital cannot reach this visit
      expect(
        (await billTests(B, 'recv', v.id, { idempotencyKey: uniq('KEY-FH'), orderIds: [ids.INVB] }))
          .status,
      ).toBe(404);
      expect((await get(B, 'recv', `/opd/visits/${v.id}/investigations`)).status).toBe(404);
    });

    it('only reception with billing.collect bills; unknown fields and prices in the body are refused', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.a]);
      const ids = await orderIds(A, v.id);
      const body = { idempotencyKey: uniq('KEY-AC'), orderIds: [ids.INVA] };
      expect((await billTests(A, 'recvNoCollect', v.id, body)).status).toBe(403);
      expect((await billTests(A, 'doc1', v.id, body)).status).toBe(403);
      expect((await billTests(A, 'admin', v.id, body)).status).toBe(403);
      for (const extra of [
        { totalPaise: 1 },
        { unitPricePaise: 1 },
        { status: 'PAID' },
        { branchId: A.east },
      ]) {
        const res = await billTests(A, 'recv', v.id, { ...body, ...extra });
        expect({ extra, status: res.status }).toEqual({ extra, status: 400 });
      }
      expect(await owner.bill.count({ where: { visitId: v.id, billType: 'INVESTIGATION' } })).toBe(
        0,
      );
    });

    it('a free test makes a zero bill: settled, no receipt; a payment list for it is refused', async () => {
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.free]);
      const ids = await orderIds(A, v.id);
      const withPay = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-FZ'),
        orderIds: [ids.INVZ],
        payments: [{ paymentModeCode: 'CASH', amountPaise: 1 }],
      });
      expect(withPay.status).toBe(400);
      expect(withPay.body.code).toBe('PAYMENT_NOT_EXPECTED');
      const ok = await billTests(A, 'recv', v.id, {
        idempotencyKey: uniq('KEY-FZ'),
        orderIds: [ids.INVZ],
      });
      expect(ok.status).toBe(201);
      expect(ok.body.bill).toMatchObject({ totalPaise: 0, paymentStatus: 'PAID' });
      expect(ok.body.bill.receipts).toEqual([]);
      expect(ok.body.orders[0].status).toBe('BILLED');
    });

    it('a price that starts in the future is not used; with tax switched on nothing is billed', async () => {
      await owner.chargeItemPrice.create({
        data: {
          tenantId: A.tenant,
          chargeItemId: A.items.b,
          amountPaise: 99_999,
          effectiveFrom: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdBy: A.user,
        },
      });
      const v = await consulting(A);
      await order(A, 'doc1', v.id, [A.items.b]);
      const pending = await get(A, 'recv', '/opd/investigations/pending');
      const row = pending.body.items.find((i: Loose) => i.visitId === v.id);
      expect(row.orders[0].pricePaise).toBe(20_000);
      const ids = await orderIds(A, v.id);
      await owner.opdSettings.update({ where: { tenantId: A.tenant }, data: { taxEnabled: true } });
      try {
        const res = await billTests(A, 'recv', v.id, {
          idempotencyKey: uniq('KEY-TX'),
          orderIds: [ids.INVB],
        });
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('TAX_NOT_SUPPORTED');
      } finally {
        await owner.opdSettings.update({
          where: { tenantId: A.tenant },
          data: { taxEnabled: false },
        });
      }
      expect(await owner.bill.count({ where: { visitId: v.id, billType: 'INVESTIGATION' } })).toBe(
        0,
      );
    });

    it('the doctor removing a test while reception bills it: one outcome, never a half state', async () => {
      for (let round = 0; round < 3; round += 1) {
        const v = await consulting(A);
        await order(A, 'doc1', v.id, [A.items.a]);
        const ids = await orderIds(A, v.id);
        const [billed, removed] = await Promise.all([
          billTests(A, 'recv', v.id, { idempotencyKey: uniq('KEY-RM'), orderIds: [ids.INVA] }),
          order(A, 'doc1', v.id, []),
        ]);
        expect(removed.status).toBe(200); // the doctor's save never crashes
        const bills = await owner.bill.count({
          where: { visitId: v.id, billType: 'INVESTIGATION' },
        });
        const rows = await owner.investigationOrder.findMany({ where: { visitId: v.id } });
        if (billed.status === 201) {
          expect(bills).toBe(1);
          expect(rows.map((r) => r.status)).toEqual(['BILLED']); // a billed test cannot be removed
        } else {
          expect(billed.status).toBe(409);
          expect(bills).toBe(0);
          expect(rows).toHaveLength(0);
        }
      }
    });

    it('audit: the bill and its payments are recorded with amounts and counts, never names', async () => {
      const { billId } = await paidTests(A);
      const rows = await auditRows(A, 'OPD_INVESTIGATION_BILL', billId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({ tests: 2, totalPaise: 50_000 });
      expect(JSON.stringify(rows[0]!.metadata)).not.toMatch(/Blood|Scan|Secret/);
    });
  });

  // ------------------------------------------------------------------------------ refunds

  describe('refund requests and approval', () => {
    it('a request moves no money; an Admin approval writes refunds in the original mode and a voucher', async () => {
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 10_000);
      expect(r.status).toBe(201);
      expect(r.body.request).toMatchObject({
        type: 'REFUND',
        status: 'REQUESTED',
        amountPaise: 10_000,
      });
      expect(r.body.request.bill.refundablePaise).toBe(v.totalPaise);
      let bill = await owner.bill.findUniqueOrThrow({ where: { id: v.billId } });
      expect(bill.refundedPaise).toBe(0);

      const ok = await approve(A, 'admin', r.body.request.id);
      expect(ok.status).toBe(200);
      expect(ok.body.request).toMatchObject({ status: 'APPROVED', amountPaise: 10_000 });
      expect(ok.body.request.refundNumber).toMatch(/\/\d{5}$/);
      expect(ok.body.request.refunds).toEqual([
        expect.objectContaining({
          amountPaise: 10_000,
          paymentMode: { code: 'CASH', name: 'CASH' },
        }),
      ]);
      bill = await owner.bill.findUniqueOrThrow({ where: { id: v.billId } });
      expect(bill).toMatchObject({
        refundedPaise: 10_000,
        paidPaise: v.totalPaise,
        totalPaise: v.totalPaise,
      });
      const ledger = await owner.ledgerEntry.findMany({
        where: { billId: v.billId, entryType: 'REFUND' },
      });
      expect(ledger.map((l) => l.amountPaise)).toEqual([10_000]);
      // a refund alone does not cancel the visit
      const visit = await owner.opdVisit.findUniqueOrThrow({ where: { id: v.id } });
      expect(visit.status).toBe('WAITING');
      // who, when, why are recorded; the audit never carries the reason text
      const created = await auditRows(A, 'OPD_REFUND_REQUEST', r.body.request.id);
      const approved = await auditRows(A, 'OPD_REFUND_APPROVE', r.body.request.id);
      expect(created).toHaveLength(1);
      expect(approved).toHaveLength(1);
      expect(JSON.stringify([created[0]!.metadata, approved[0]!.metadata])).not.toMatch(
        /Wrong bill/,
      );
      expect(approved[0]!.actorUserId).toBe(A.users.admin);
    });

    it('amounts: any amount up to what is left; zero, negative, fractions and too much are refused', async () => {
      const v = await waiting(A);
      for (const amountPaise of [0, -1, 1.5, 'x']) {
        const res = await reqRefund(A, 'recv', v.billId, amountPaise as number);
        expect({ amountPaise, status: res.status }).toEqual({ amountPaise, status: 400 });
      }
      const tooMuch = await reqRefund(A, 'recv', v.billId, v.totalPaise + 1);
      expect(tooMuch.status).toBe(409);
      expect(tooMuch.body.code).toBe('REFUND_EXCEEDS_REFUNDABLE');
      const all = await reqRefund(A, 'recv', v.billId, v.totalPaise);
      expect(all.status).toBe(201);
      const blank = await reqRefund(A, 'recv', v.billId, 1, { reason: '   ' });
      expect(blank.status).toBe(400);
      expect(await reqRefund(A, 'recv', 'no-such-bill', 1)).toMatchObject({ status: 404 });
    });

    it('open requests count against what is left; approved refunds shrink it; the end is refused', async () => {
      const v = await waiting(A);
      const total = v.totalPaise;
      const first = await reqRefund(A, 'recv', v.billId, total - 20_000);
      expect(first.status).toBe(201);
      const over = await reqRefund(A, 'recv', v.billId, 30_000);
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({
        code: 'REFUND_EXCEEDS_REFUNDABLE',
        pendingPaise: total - 20_000,
      });
      expect((await approve(A, 'admin', first.body.request.id)).status).toBe(200);
      const rest = await reqRefund(A, 'recv', v.billId, 20_001);
      expect(rest.status).toBe(409);
      const last = await reqRefund(A, 'recv', v.billId, 20_000);
      expect(last.status).toBe(201);
      expect((await approve(A, 'admin', last.body.request.id)).status).toBe(200);
      const bill = await owner.bill.findUniqueOrThrow({ where: { id: v.billId } });
      expect(bill.refundedPaise).toBe(total);
      expect((await reqRefund(A, 'recv', v.billId, 1)).status).toBe(409);
    });

    it('the same key returns the same request; the same key for something else is refused', async () => {
      const v = await waiting(A);
      const key = uniq('KEY-RK');
      const first = await reqRefund(A, 'recv', v.billId, 5_000, { idempotencyKey: key });
      const again = await reqRefund(A, 'recv', v.billId, 5_000, { idempotencyKey: key });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.request.id).toBe(first.body.request.id);
      const diff = await reqRefund(A, 'recv', v.billId, 6_000, { idempotencyKey: key });
      expect(diff.status).toBe(409);
      expect(diff.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await owner.refundRequest.count({ where: { billId: v.billId } })).toBe(1);
    });

    it('only an Admin decides, never the person who asked (not even with both permissions)', async () => {
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 1_000);
      const id = r.body.request.id;
      expect((await approve(A, 'recv', id)).status).toBe(403);
      expect((await reject(A, 'recv', id)).status).toBe(403);
      expect((await reqRefund(A, 'admin', v.billId, 1)).status).toBe(403);
      // a user who holds both permissions asks and tries to decide: refused
      const own = await reqRefund(A, 'both', v.billId, 1_000);
      expect(own.status).toBe(201);
      const self = await approve(A, 'both', own.body.request.id);
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
      expect((await reject(A, 'both', own.body.request.id)).body.code).toBe(
        'SELF_APPROVAL_FORBIDDEN',
      );
      // someone else may decide it
      expect((await approve(A, 'admin', own.body.request.id)).status).toBe(200);
      // and also the other one's request is untouched by all of this
      expect((await owner.refundRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
        'REQUESTED',
      );
    });

    it('deciding twice: the same Admin gets the same answer, another Admin a clear refusal; money moves once', async () => {
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 7_000);
      const id = r.body.request.id;
      expect((await approve(A, 'admin', id)).status).toBe(200);
      const again = await approve(A, 'admin', id);
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      const other = await approve(A, 'admin2', id);
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('REQUEST_ALREADY_DECIDED');
      expect((await reject(A, 'admin2', id)).status).toBe(409);
      expect(await refundsOf(id)).toHaveLength(1);
      expect((await owner.bill.findUniqueOrThrow({ where: { id: v.billId } })).refundedPaise).toBe(
        7_000,
      );
    });

    it('two Admins approving the same request at the same moment: one wins, the money moves once', async () => {
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 9_000);
      const id = r.body.request.id;
      const [a, b] = await Promise.all([approve(A, 'admin', id), approve(A, 'admin2', id)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await refundsOf(id)).toHaveLength(1);
      expect((await owner.bill.findUniqueOrThrow({ where: { id: v.billId } })).refundedPaise).toBe(
        9_000,
      );
    });

    it('two requests that fit together are both approved at once; the bill is never over-refunded', async () => {
      const v = await waiting(A);
      const half = v.totalPaise / 2;
      const r1 = await reqRefund(A, 'recv', v.billId, half);
      const r2 = await reqRefund(A, 'recv2', v.billId, half);
      expect([r1.status, r2.status]).toEqual([201, 201]);
      const [a, b] = await Promise.all([
        approve(A, 'admin', r1.body.request.id),
        approve(A, 'admin2', r2.body.request.id),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const bill = await owner.bill.findUniqueOrThrow({ where: { id: v.billId } });
      expect(bill.refundedPaise).toBe(v.totalPaise);
      expect(bill.refundedPaise).toBeLessThanOrEqual(bill.paidPaise);
      const numbers = [a.body.request.refundNumber, b.body.request.refundNumber];
      expect(new Set(numbers).size).toBe(2);
    });

    it('two requests asked at the same moment that do not fit together: one is refused cleanly', async () => {
      const v = await waiting(A);
      const big = Math.floor((v.totalPaise * 2) / 3);
      const [a, b] = await Promise.all([
        reqRefund(A, 'recv', v.billId, big),
        reqRefund(A, 'recv2', v.billId, big),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(['RULE_REFUSED', 'REFUND_EXCEEDS_REFUNDABLE']).toContain(loser.body.code);
      expect(await owner.refundRequest.count({ where: { billId: v.billId } })).toBe(1);
    });

    it('reject: a note is required, nothing moves, a rejected request cannot be approved', async () => {
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 3_000);
      const id = r.body.request.id;
      expect((await reject(A, 'admin', id, {})).status).toBe(400);
      const blank = await reject(A, 'admin', id, { note: '  ' });
      expect(blank.status).toBe(400);
      expect(blank.body.code).toBe('REASON_REQUIRED');
      const ok = await reject(A, 'admin', id, { note: 'Patient was seen' });
      expect(ok.status).toBe(200);
      expect(ok.body.request).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Patient was seen',
        refundNumber: null,
      });
      expect((await approve(A, 'admin2', id)).status).toBe(409);
      expect(await refundsOf(id)).toHaveLength(0);
      expect((await owner.bill.findUniqueOrThrow({ where: { id: v.billId } })).refundedPaise).toBe(
        0,
      );
      expect(await auditRows(A, 'OPD_REFUND_REJECT', id)).toHaveLength(1);
      // a rejected request no longer counts against what is left
      expect((await reqRefund(A, 'recv', v.billId, v.totalPaise)).status).toBe(201);
    });

    it('no refund of the consultation once it has started (asking, and approving a request made earlier)', async () => {
      const v = await waiting(A);
      const early = await reqRefund(A, 'recv', v.billId, 5_000);
      expect(early.status).toBe(201);
      expect((await start(A, 'doc1', v.id)).status).toBe(200);
      const late = await reqRefund(A, 'recv', v.billId, 1_000);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('CONSULTATION_STARTED');
      const blocked = await approve(A, 'admin', early.body.request.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('CONSULTATION_STARTED');
      expect(await refundsOf(early.body.request.id)).toHaveLength(0);
      expect(
        (await owner.refundRequest.findUniqueOrThrow({ where: { id: early.body.request.id } }))
          .status,
      ).toBe('REQUESTED');
      // the Admin can still reject it
      expect((await reject(A, 'admin', early.body.request.id)).status).toBe(200);
    });

    it('the doctor starting at the same moment as the approval: the answers always agree with the stored money', async () => {
      for (let round = 0; round < 3; round += 1) {
        const v = await waiting(A);
        const r = await reqRefund(A, 'recv', v.billId, 5_000);
        const [a, s] = await Promise.all([
          approve(A, 'admin', r.body.request.id),
          start(A, 'doc1', v.id),
        ]);
        // starting a consultation is never blocked by a refund of part of the fee
        expect(s.status).toBe(200);
        expect([200, 409]).toContain(a.status);
        const refunded = await refundsOf(r.body.request.id);
        const bill = await owner.bill.findUniqueOrThrow({ where: { id: v.billId } });
        if (a.status === 200) {
          // the refund won the race and happened BEFORE the consultation started
          expect(refunded).toHaveLength(1);
          expect(bill.refundedPaise).toBe(5_000);
        } else {
          // the consultation won: no money moved, and the answer says why. Either the early
          // check saw it (CONSULTATION_STARTED) or the DATABASE rule caught the race (RULE_REFUSED).
          expect(['CONSULTATION_STARTED', 'RULE_REFUSED']).toContain(a.body.code);
          expect(refunded).toHaveLength(0);
          expect(bill.refundedPaise).toBe(0);
        }
      }
    });

    it('a test bill can still be refunded after the consultation; each refund follows its payment mode', async () => {
      const { visit, billId } = await paidTests(A, true); // UPI 300 + cash 200, doctor still consulting
      await finish(A, 'doc1', visit.id);
      const r = await reqRefund(A, 'recv', billId, 35_000, { reason: 'Test not taken' });
      expect(r.status).toBe(201);
      // a UPI refund needs its reference
      const noRef = await approve(A, 'admin', r.body.request.id);
      expect(noRef.status).toBe(400);
      expect(noRef.body).toMatchObject({ code: 'REFERENCE_REQUIRED', paymentModeCode: 'UPI' });
      expect(
        (await owner.refundRequest.findUniqueOrThrow({ where: { id: r.body.request.id } })).status,
      ).toBe('REQUESTED');
      expect(await refundsOf(r.body.request.id)).toHaveLength(0);
      const ok = await approve(A, 'admin', r.body.request.id, {
        references: { UPI: 'RF-UPI-1' },
        note: 'ok',
      });
      expect(ok.status).toBe(200);
      const rows = ok.body.request.refunds as Loose[];
      expect(rows.reduce((s, x) => s + x.amountPaise, 0)).toBe(35_000);
      const byMode = (m: string) =>
        rows.filter((x) => x.paymentMode.code === m).reduce((s, x) => s + x.amountPaise, 0);
      expect(byMode('UPI')).toBeLessThanOrEqual(30_000);
      expect(byMode('CASH')).toBeLessThanOrEqual(20_000);
      expect(rows.find((x) => x.paymentMode.code === 'UPI').referenceNo).toBe('RF-UPI-1');
      // the rest: together exactly what each payment received, nothing more
      const rest = await reqRefund(A, 'recv', billId, 15_000);
      expect(rest.status).toBe(201);
      const done = await approve(A, 'admin2', rest.body.request.id, {
        references: { UPI: 'RF-UPI-2' },
      });
      expect(done.status).toBe(200);
      const all = await owner.refund.findMany({
        where: { billId },
        include: { paymentMode: true },
      });
      const sum = (m: string) =>
        all.filter((x) => x.paymentMode.code === m).reduce((s, x) => s + x.amountPaise, 0);
      expect({ upi: sum('UPI'), cash: sum('CASH') }).toEqual({ upi: 30_000, cash: 20_000 });
      const bill = await owner.bill.findUniqueOrThrow({ where: { id: billId } });
      expect(bill).toMatchObject({
        refundedPaise: 50_000,
        paidPaise: 50_000,
        paymentStatus: 'PAID',
      });
      expect((await reqRefund(A, 'recv', billId, 1)).status).toBe(409);
      // the refund ledger rows equal the refund rows
      const ledger = await owner.ledgerEntry.findMany({ where: { billId, entryType: 'REFUND' } });
      expect(ledger.reduce((s, l) => s + l.amountPaise, 0)).toBe(50_000);
    });

    it('bad input is refused with 400 and nothing is written (sizes, types, extra fields)', async () => {
      const v = await waiting(A);
      const good = { amountPaise: 100, reason: 'r', idempotencyKey: uniq('KEY-BI') };
      const bads: object[] = [
        { amountPaise: 2_147_483_648 },
        { reason: 'x'.repeat(501) },
        { idempotencyKey: 'short' },
        { idempotencyKey: 'has space in it' },
        { idempotencyKey: 'k'.repeat(65) },
        { status: 'APPROVED' },
        { decidedBy: A.users.admin },
        { branchId: A.east },
        { requestType: 'CANCEL_VISIT' },
      ];
      for (const bad of bads) {
        const res = await post(A, 'recv', `/opd/bills/${v.billId}/refund-requests`, {
          ...good,
          ...bad,
        });
        expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
      }
      const cancelBads: object[] = [
        { amountPaise: -1 },
        { amountPaise: 1.5 },
        { reason: '' },
        { billId: v.billId },
      ];
      for (const bad of cancelBads) {
        const res = await post(A, 'recv', `/opd/visits/${v.id}/cancel-requests`, {
          reason: 'r',
          idempotencyKey: uniq('KEY-BC'),
          ...bad,
        });
        expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
      }
      const r = await reqRefund(A, 'recv', v.billId, 100);
      const approveBads: object[] = [
        { references: 'UPI' },
        { references: ['x'] },
        { note: 'n'.repeat(501) },
        { amountPaise: 1 },
        { status: 'APPROVED' },
      ];
      for (const bad of approveBads) {
        const res = await approve(A, 'admin', r.body.request.id, bad);
        expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
      }
      expect((await reject(A, 'admin', r.body.request.id, { note: 'n'.repeat(501) })).status).toBe(
        400,
      );
      expect((await reject(A, 'admin', r.body.request.id, { note: 'ok', extra: 1 })).status).toBe(
        400,
      );
      expect(await owner.refundRequest.count({ where: { billId: v.billId } })).toBe(1);
      expect(
        (await owner.refundRequest.findFirstOrThrow({ where: { billId: v.billId } })).status,
      ).toBe('REQUESTED');
    });

    it('a reference that is not text or too long is a clean 400, not a crash', async () => {
      const { billId } = await paidTests(A, true);
      const r = await reqRefund(A, 'recv', billId, 50_000);
      const id = r.body.request.id;
      const wrong: object[] = [
        { UPI: 123 },
        { UPI: { a: 1 } },
        { UPI: 'R'.repeat(65) },
        { UPI: ['x'] },
      ];
      for (const references of wrong) {
        const res = await approve(A, 'admin', id, { references });
        expect({ references, status: res.status, code: res.body.code }).toEqual({
          references,
          status: 400,
          code: 'REFERENCE_INVALID',
        });
      }
      expect(await refundsOf(id)).toHaveLength(0);
      // other keys never matter: only the mode codes of the payments are read
      const ok = await approve(A, 'admin', id, {
        references: { UPI: 'RF-OK', CASH: 'x', toString: 'y' },
      });
      expect(ok.status).toBe(200);
    });

    it('a hospital with no REFUND number series: refusing cleanly, nothing moves; a free cancellation still works', async () => {
      const v = await waiting(C);
      const r = await reqRefund(C, 'recv', v.billId, 1_000);
      expect(r.status).toBe(201);
      const res = await approve(C, 'admin', r.body.request.id);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'NUMBER_SERIES_NOT_CONFIGURED', series: 'REFUND' });
      expect(
        (await owner.refundRequest.findUniqueOrThrow({ where: { id: r.body.request.id } })).status,
      ).toBe('REQUESTED');
      expect(await refundsOf(r.body.request.id)).toHaveLength(0);
      expect((await owner.bill.findUniqueOrThrow({ where: { id: v.billId } })).refundedPaise).toBe(
        0,
      );
      // a cancellation that returns no money needs no voucher number
      await reject(C, 'admin', r.body.request.id);
      const w = await waiting(C);
      const none = await reqCancel(C, 'recv', w.id, { amountPaise: 0 });
      expect((await approve(C, 'admin', none.body.request.id)).status).toBe(200);
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: w.id } })).status).toBe(
        'CANCELLED',
      );
    });

    it('a failed approval takes no refund number (no gaps)', async () => {
      const { billId } = await paidTests(A, true);
      const r = await reqRefund(A, 'recv', billId, 40_000);
      const before = await owner.refundRequest.findMany({
        where: { tenantId: A.tenant, refundNumber: { not: null } },
        select: { refundNumber: true },
      });
      expect((await approve(A, 'admin', r.body.request.id)).status).toBe(400); // UPI reference missing
      const ok = await approve(A, 'admin', r.body.request.id, { references: { UPI: 'RF-GAP' } });
      expect(ok.status).toBe(200);
      const numbers = (
        await owner.refundRequest.findMany({
          where: { tenantId: A.tenant, refundNumber: { not: null } },
          select: { refundNumber: true },
          orderBy: { refundNumber: 'asc' },
        })
      ).map((x) => Number(x.refundNumber!.split('/')[1]));
      expect(numbers).toHaveLength(before.length + 1);
      numbers.forEach((n, i) => expect(n).toBe(numbers[0]! + i));
    });

    it('requests of another branch or hospital are "not found"; lists are scoped to the branch', async () => {
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 1_000);
      const id = r.body.request.id;
      expect((await get(A, 'adminEast', `/opd/refund-requests/${id}`)).status).toBe(404);
      expect((await approve(A, 'adminEast', id)).status).toBe(404);
      expect((await reject(A, 'adminEast', id)).status).toBe(404);
      expect((await get(B, 'admin', `/opd/refund-requests/${id}`)).status).toBe(404);
      expect((await approve(B, 'admin', id)).status).toBe(404);
      const east = await get(A, 'adminEast', '/opd/refund-requests');
      expect(east.body.items.find((i: Loose) => i.id === id)).toBeUndefined();
      expect((await reqRefund(B, 'recv', v.billId, 1_000)).status).toBe(404);
      expect((await reqCancel(B, 'recv', v.id)).status).toBe(404);
      expect((await owner.refundRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
        'REQUESTED',
      );
    });

    it('the pending-approvals count (Step 2.1c): only for people who may decide, only requests waiting, only their branches, down when decided', async () => {
      const count = async (h: Hospital, who: string) => {
        const res = await get(h, who, '/opd/refund-requests/pending-count');
        expect(res.status).toBe(200);
        return res.body.count as number;
      };
      const before = await count(A, 'admin');
      const v = await waiting(A);
      const r = await reqRefund(A, 'recv', v.billId, 500);
      const cancel = await reqCancel(A, 'recv', (await waiting(A)).id);
      expect(r.status).toBe(201);
      expect(cancel.status).toBe(201);
      // refund and cancellation requests both count; the other branch's admin and the other hospital do not
      expect(await count(A, 'admin')).toBe(before + 2);
      expect(await count(A, 'admin2')).toBe(before + 2);
      expect(await count(A, 'adminEast')).toBe(0);
      expect(await count(B, 'admin')).toBe(0);
      // deciding lowers the count by one each time, approve or reject
      await reject(A, 'admin', r.body.request.id).expect(200);
      expect(await count(A, 'admin')).toBe(before + 1);
      await approve(A, 'admin', cancel.body.request.id).expect(200);
      expect(await count(A, 'admin')).toBe(before);
      // people who cannot decide are refused (deny by default), and there is no token
      for (const who of ['recv', 'recvNoCollect', 'nurse', 'docNoProfile', 'nobody']) {
        expect((await get(A, who, '/opd/refund-requests/pending-count')).status).toBe(403);
      }
      expect((await http().get('/opd/refund-requests/pending-count')).status).toBe(401);
    });

    it('the dashboard summary (Step 2.1d): real counts, blocks follow permissions, other branch and hospital not mixed in', async () => {
      const summary = async (h: Hospital, who: string) => {
        const res = await get(h, who, '/dashboard/summary');
        expect(res.status).toBe(200);
        return res.body;
      };
      const before = await summary(A, 'admin');
      const beforeEast = await summary(A, 'adminEast');
      const beforeB = await summary(B, 'admin');
      await waiting(A);
      const after = await summary(A, 'admin');
      expect(after.today.visits).toBe(before.today.visits + 1);
      expect(after.trend).toHaveLength(14);
      expect(after.trend[13].visits).toBe(before.trend[13].visits + 1);
      expect(after.sections.approvals).toBe(true);
      expect(typeof after.pendingApprovals).toBe('number');
      // the money block follows the billing permission; approvals follow the approve permission
      const recv = await summary(A, 'recv');
      expect(recv.sections.approvals).toBe(false);
      expect(recv.pendingApprovals).toBeNull();
      expect(recv.sections.money ? typeof recv.today.collectionPaise : 'null').not.toBe(
        'undefined',
      );
      // another branch and another hospital are counted on their own
      const east = await summary(A, 'adminEast');
      expect(east.today.visits).toBe(beforeEast.today.visits);
      expect((await summary(B, 'admin')).today.visits).toBe(beforeB.today.visits);
      expect((await http().get('/dashboard/summary')).status).toBe(401);
    });

    it('lists newest first with a status filter and paging; a wrong status is 400', async () => {
      const v = await waiting(A);
      const a = await reqRefund(A, 'recv', v.billId, 100);
      const b = await reqRefund(A, 'recv', v.billId, 200);
      await reject(A, 'admin', a.body.request.id);
      const open = await get(A, 'recv', '/opd/refund-requests?status=REQUESTED&pageSize=100');
      expect(open.status).toBe(200);
      expect(open.body.items.every((i: Loose) => i.status === 'REQUESTED')).toBe(true);
      expect(open.body.items.map((i: Loose) => i.id)).toContain(b.body.request.id);
      expect(open.body.items.map((i: Loose) => i.id)).not.toContain(a.body.request.id);
      const paged = await get(A, 'admin', '/opd/refund-requests?pageSize=1&page=2');
      expect(paged.body).toMatchObject({ page: 2, pageSize: 1 });
      expect(paged.body.items).toHaveLength(1);
      expect((await get(A, 'admin', '/opd/refund-requests?status=NOPE')).status).toBe(400);
      const times = (await get(A, 'admin', '/opd/refund-requests?pageSize=100')).body.items.map(
        (i: Loose) => i.requestedAt,
      );
      expect([...times].sort().reverse()).toEqual(times);
    });
  });

  // ----------------------------------------------------------------------------- cancel

  describe('cancelling a waiting visit', () => {
    it('approval returns the fee, cancels the visit and takes it out of the doctor queue', async () => {
      const v = await waiting(A);
      const queued = await get(A, 'doc1', '/opd/queue');
      expect(queued.body.items.map((i: Loose) => i.id)).toContain(v.id);
      const r = await reqCancel(A, 'recv', v.id);
      expect(r.status).toBe(201);
      expect(r.body.request).toMatchObject({
        type: 'CANCEL_VISIT',
        amountPaise: v.totalPaise,
        status: 'REQUESTED',
      });
      // nothing happens until the Admin decides
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe(
        'WAITING',
      );
      const dup = await reqCancel(A, 'recv2', v.id);
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('REFUND_REQUEST_OPEN');
      const ok = await approve(A, 'admin', r.body.request.id);
      expect(ok.status).toBe(200);
      const visit = await owner.opdVisit.findUniqueOrThrow({ where: { id: v.id } });
      expect(visit).toMatchObject({ status: 'CANCELLED', cancelledReason: 'Patient left' });
      expect(visit.cancelledAt).not.toBeNull();
      expect(visit.tokenNo).not.toBeNull(); // the token number stays on record, but it is void
      const bill = await owner.bill.findUniqueOrThrow({ where: { id: v.billId } });
      expect(bill.refundedPaise).toBe(v.totalPaise);
      const after = await get(A, 'doc1', '/opd/queue');
      expect(after.body.items.map((i: Loose) => i.id)).not.toContain(v.id);
      expect(await auditRows(A, 'OPD_VISIT_CANCEL', v.id)).toHaveLength(1);
      // a cancelled visit cannot be started, cancelled again or refunded further
      expect((await start(A, 'doc1', v.id)).status).toBe(409);
      expect((await reqCancel(A, 'recv', v.id)).status).toBe(409);
      expect((await reqRefund(A, 'recv', v.billId, 1)).status).toBe(409);
    });

    it('a cancelled visit keeps its token number on record (shown as cancelled) and the number is never given again', async () => {
      const v1 = await waiting(A);
      const before = (await get(A, 'recv', `/opd/visits/${v1.id}`)).body;
      expect(before.status).toBe('WAITING');
      const r = await reqCancel(A, 'recv', v1.id);
      expect((await approve(A, 'admin', r.body.request.id)).status).toBe(200);
      const after = (await get(A, 'recv', `/opd/visits/${v1.id}`)).body;
      expect(after.status).toBe('CANCELLED');
      expect(after.token).toEqual(before.token); // same date, number and label
      // the next visit of the day gets a new, higher number
      const v2 = await waiting(A);
      const next = (await get(A, 'recv', `/opd/visits/${v2.id}`)).body;
      expect(next.token.date).toBe(before.token.date);
      expect(next.token.no).toBeGreaterThan(before.token.no);
      // the cancelled visit is still listed for the patient with its token, so the screen can mark it
      const history = await get(A, 'recv', `/patients/${before.patient.id}/visits`);
      const row = history.body.items.find((i: Loose) => i.id === v1.id);
      expect(row).toMatchObject({ status: 'CANCELLED', token: before.token });
    });

    it('the receptionist may keep part of the fee (a smaller amount, or none)', async () => {
      const v = await waiting(A);
      const r = await reqCancel(A, 'recv', v.id, { amountPaise: 50_000 });
      expect(r.body.request.amountPaise).toBe(50_000);
      const ok = await approve(A, 'admin', r.body.request.id);
      expect(ok.status).toBe(200);
      expect((await owner.bill.findUniqueOrThrow({ where: { id: v.billId } })).refundedPaise).toBe(
        50_000,
      );
      const w = await waiting(A);
      const none = await reqCancel(A, 'recv', w.id, { amountPaise: 0 });
      expect(none.body.request.amountPaise).toBe(0);
      const done = await approve(A, 'admin', none.body.request.id);
      expect(done.status).toBe(200);
      expect(done.body.request.refundNumber).toBeNull();
      expect(done.body.request.refunds).toEqual([]);
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: w.id } })).status).toBe(
        'CANCELLED',
      );
      const over = await reqCancel(A, 'recv', (await waiting(A)).id, { amountPaise: 999_999 });
      expect(over.status).toBe(409);
    });

    it('a free follow-up visit is cancelled without any money moving', async () => {
      const patient = await newPatient(A);
      const first = await waiting(A, A.doc1, patient);
      expect((await start(A, 'doc1', first.id)).status).toBe(200);
      await finish(A, 'doc1', first.id);
      const free = await waiting(A, A.doc1, patient, 'FOLLOW_UP');
      expect(free.totalPaise).toBe(0);
      // nothing was paid, so nothing can be refunded
      expect((await reqRefund(A, 'recv', free.billId, 1)).status).toBe(409);
      const r = await reqCancel(A, 'recv', free.id);
      expect(r.status).toBe(201);
      expect(r.body.request.amountPaise).toBe(0);
      const ok = await approve(A, 'admin', r.body.request.id);
      expect(ok.status).toBe(200);
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: free.id } })).status).toBe(
        'CANCELLED',
      );
      expect(await owner.refund.count({ where: { requestId: r.body.request.id } })).toBe(0);
    });

    it('a started visit cannot be cancelled; a cancel request that went stale cannot be approved', async () => {
      const v = await consulting(A);
      const late = await reqCancel(A, 'recv', v.id);
      expect(late.status).toBe(409);
      expect(['CONSULTATION_STARTED', 'VISIT_NOT_WAITING']).toContain(late.body.code);
      const w = await waiting(A);
      const r = await reqCancel(A, 'recv', w.id);
      expect((await start(A, 'doc1', w.id)).status).toBe(200);
      const stale = await approve(A, 'admin', r.body.request.id);
      expect(stale.status).toBe(409);
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: w.id } })).status).toBe(
        'IN_CONSULTATION',
      );
      expect(await owner.refund.count({ where: { requestId: r.body.request.id } })).toBe(0);
    });

    it('a rejected cancellation leaves the visit waiting and in the queue', async () => {
      const v = await waiting(A);
      const r = await reqCancel(A, 'recv', v.id);
      expect(
        (await reject(A, 'admin', r.body.request.id, { note: 'Patient is here' })).status,
      ).toBe(200);
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe(
        'WAITING',
      );
      expect((await get(A, 'doc1', '/opd/queue')).body.items.map((i: Loose) => i.id)).toContain(
        v.id,
      );
      // and it can be asked again
      expect((await reqCancel(A, 'recv', v.id)).status).toBe(201);
    });
  });
});
