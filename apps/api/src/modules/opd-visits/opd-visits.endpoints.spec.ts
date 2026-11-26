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
import { ensureSystemRolesForTenant } from '../../../prisma/seeds/reference';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for OPD visit tests`);
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

const NEW_FEE = 50_000;
const FOLLOW_UP_FEE = 30_000;
const DOC2_NEW_FEE = 80_000;
const REG_FEE = 10_000;
const FY_FORMAT = [
  { type: 'FINANCIAL_YEAR', style: 'SHORT' },
  { type: 'SEPARATOR', text: '/' },
  { type: 'RUNNING', width: 5 },
];
const OPD_PERMS = [
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'patients.registry.read',
] as const;

type Hospital = {
  tenant: string;
  main: string;
  east: string;
  cashId: string;
  doc1: string;
  doc2: string;
  doc3Off: string;
  doc4EastOnly: string;
  doc5NoFee: string;
  user: string;
  tokens: Record<string, string>;
  users: Record<string, string>;
};

describe('OPD visits and billing endpoints (HTTP)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}-${stamp}-${(seq += 1)}`;
  let A: Hospital;
  let B: Hospital;

  async function seedHospital(label: string): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `OV_${label}_${stamp}`,
        name: `Visits ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `ov-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `ov-${label}-e-${stamp}` },
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
    for (const series of ['BILL', 'RECEIPT'] as const) {
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
    const mode = (code: string, requiresReference: boolean, active = true) =>
      owner.paymentMode.create({
        data: { tenantId: tenant, code, name: code, requiresReference, active },
      });
    const cash = await mode('CASH', false);
    await mode('UPI', true);
    await mode('CARD', false);
    await mode('OLD', false, false);

    const staff = await owner.user.create({
      data: {
        tenantId: tenant,
        code: `S${label}${stamp}`,
        email: `ov_s_${label}_${stamp}@example.test`,
        displayName: 'Setup',
        passwordHash: 'x',
      },
    });
    const regItem = await owner.chargeItem.create({
      data: { tenantId: tenant, code: 'REG', name: 'Registration', kind: 'REGISTRATION' },
    });
    await owner.chargeItemPrice.create({
      data: {
        tenantId: tenant,
        chargeItemId: regItem.id,
        amountPaise: REG_FEE,
        effectiveFrom: new Date('2020-01-01'),
        createdBy: staff.id,
      },
    });

    const perms = await owner.permission.findMany({ where: { code: { in: [...OPD_PERMS] } } });
    if (perms.length !== OPD_PERMS.length) {
      throw new Error('OPD permissions missing from the test catalog');
    }
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));

    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    async function makeUser(key: string, codes: readonly string[], branches: string[]) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `ov_${key}_${label}_${stamp}@example.test`,
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

    await makeUser('recv', OPD_PERMS, [main]);
    await makeUser(
      'recvNoCollect',
      ['opd.visits.create', 'opd.visits.read', 'opd.billing.read'],
      [main],
    );
    await makeUser('recvEast', OPD_PERMS, [east]);
    await makeUser('nurse', ['opd.visits.read'], [main]);
    await makeUser('nobody', [], [main]);

    async function makeDoctor(
      key: string,
      branches: string[],
      opts: { on?: boolean; fees?: boolean; fee?: number },
    ) {
      const u = await makeUser(key, ['opd.visits.read'], branches);
      const profile = await owner.doctorProfile.create({
        data: {
          tenantId: tenant,
          userId: u.id,
          code: `DOC_${key}_${label}_${stamp}`,
          availabilityOn: opts.on ?? true,
        },
      });
      if (opts.fees !== false) {
        const base = opts.fee ?? NEW_FEE;
        for (const [type, amount] of [
          ['NEW', base],
          ['FOLLOW_UP', FOLLOW_UP_FEE],
        ] as const) {
          await owner.doctorFee.create({
            data: {
              tenantId: tenant,
              doctorProfileId: profile.id,
              visitType: type,
              amountPaise: amount,
              effectiveFrom: new Date('2020-01-01'),
              createdBy: staff.id,
            },
          });
        }
      }
      return profile.id;
    }
    const doc1 = await makeDoctor('doc1', [main], {});
    const doc2 = await makeDoctor('doc2', [main], { fee: DOC2_NEW_FEE });
    const doc3Off = await makeDoctor('doc3off', [main], { on: false });
    const doc4EastOnly = await makeDoctor('doc4east', [east], {});
    const doc5NoFee = await makeDoctor('doc5nofee', [main], { fees: false });

    return {
      tenant,
      main,
      east,
      cashId: cash.id,
      doc1,
      doc2,
      doc3Off,
      doc4EastOnly,
      doc5NoFee,
      user: staff.id,
      tokens,
      users,
    };
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
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(() => {
    clock.set(new Date());
  });

  const http = () => request(app.getHttpServer());
  const asOwner = async <T>(fn: (c: import('pg').Client) => Promise<T>): Promise<T> => {
    const c = createPgClient('owner');
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  let patientCounter = 0;
  async function newPatient(h: Hospital, extra: { isActive?: boolean } = {}): Promise<string> {
    patientCounter += 1;
    const p = await owner.patient.create({
      data: {
        tenantId: h.tenant,
        uhid: `OV${h.tenant.slice(-6)}${stamp}${patientCounter}`,
        registeredBranchId: h.main,
        name: `Secret Name ${patientCounter}`,
        phone: `+91989${String(patientCounter).padStart(7, '0')}`,
        createdBy: h.user,
        isActive: extra.isActive ?? true,
      },
    });
    return p.id;
  }

  type CreateBody = Partial<{
    patientId: string;
    doctorProfileId: string;
    visitType: string;
    idempotencyKey: string;
    paymentModeCode: string;
    referenceNo: string;
  }> &
    Record<string, unknown>;

  function create(h: Hospital, who: string, body: CreateBody) {
    return http().post('/opd/visits').set('Authorization', `Bearer ${h.tokens[who]}`).send(body);
  }
  function preview(h: Hospital, who: string, body: Record<string, unknown>) {
    return http()
      .post('/opd/visits/preview')
      .set('Authorization', `Bearer ${h.tokens[who]}`)
      .send(body);
  }
  async function visit(
    h: Hospital,
    o: { patient?: string; doctor?: string; type?: string; key?: string; who?: string } = {},
  ) {
    const patientId = o.patient ?? (await newPatient(h));
    const res = await create(h, o.who ?? 'recv', {
      patientId,
      doctorProfileId: o.doctor ?? h.doc1,
      visitType: o.type ?? 'NEW',
      idempotencyKey: o.key ?? uniq('KEY-AAAA'),
    });
    return { res, patientId };
  }
  const counts = async (h: Hospital) =>
    owner.opdVisit.count({ where: { tenantId: h.tenant } }).then(async (visits) => ({
      visits,
      bills: await owner.bill.count({ where: { tenantId: h.tenant } }),
      payments: await owner.payment.count({ where: { tenantId: h.tenant } }),
      receipts: await owner.receipt.count({ where: { tenantId: h.tenant } }),
      ledger: await owner.ledgerEntry.count({ where: { tenantId: h.tenant } }),
    }));
  async function complete(visitId: string) {
    await asOwner(async (c) => {
      await c.query(
        `UPDATE opd_visits SET status='IN_CONSULTATION', consultation_started_at=now(), updated_at=now() WHERE id=$1`,
        [visitId],
      );
      // A visit completes only with a completed note (Step 5a-2).
      await c.query(
        `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id, diagnosis)
         SELECT gen_random_uuid()::text, tenant_id, branch_id, id, doctor_profile_id, 'test note'
           FROM opd_visits WHERE id = $1`,
        [visitId],
      );
      await c.query(
        `UPDATE consultations SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE visit_id=$1`,
        [visitId],
      );
      await c.query(
        `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
        [visitId],
      );
    });
  }
  const suffix = (n: string) => Number(n.split('/')[1]);

  // ------------------------------------------------------------------------------ access

  describe('access and input', () => {
    it('401 without a token or with a patient token; 403 without the permission', async () => {
      const body = {
        patientId: 'x',
        doctorProfileId: 'y',
        visitType: 'NEW',
        idempotencyKey: 'KEY-12345678',
      };
      expect((await http().post('/opd/visits').send(body)).status).toBe(401);
      expect((await http().get('/opd/doctors')).status).toBe(401);
      const patientToken = tokenService.signPatientAccess({ accountId: 'acc' });
      expect(
        (await http().post('/opd/visits').set('Authorization', `Bearer ${patientToken}`).send(body))
          .status,
      ).toBe(401);
      for (const who of ['nurse', 'nobody', 'doc1']) {
        expect((await create(A, who, body)).status).toBe(403);
        expect(
          (await http().get('/opd/doctors').set('Authorization', `Bearer ${A.tokens[who]}`)).status,
        ).toBe(403);
      }
    });

    it('creating needs opd.billing.collect too: without it nothing is created', async () => {
      const before = await counts(A);
      const { res } = await visit(A, { who: 'recvNoCollect' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await counts(A)).toEqual(before);
    });

    it('rejects branch, tenant, amount and status fields (they come from the token and price lists)', async () => {
      const patientId = await newPatient(A);
      const base = {
        patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-AAAA'),
      };
      for (const extra of [
        { branchId: A.east },
        { tenantId: B.tenant },
        { totalPaise: 1 },
        { amountPaise: 1 },
        { status: 'WAITING' },
      ]) {
        expect((await create(A, 'recv', { ...base, ...extra })).status).toBe(400);
      }
      for (const bad of [
        { visitType: 'EMERGENCY' },
        { idempotencyKey: 'short' },
        { idempotencyKey: 'has space in key' },
        { patientId: '' },
        { patientId: 5 },
      ]) {
        expect((await create(A, 'recv', { ...base, ...bad })).status).toBe(400);
      }
      expect((await create(A, 'recv', { ...base, idempotencyKey: undefined })).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------------------ doctors

  describe('GET /opd/doctors', () => {
    it('lists the active branch doctors with availability and fees, never other branches or hospitals', async () => {
      const res = await http().get('/opd/doctors').set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(res.status).toBe(200);
      const byId = Object.fromEntries(res.body.items.map((d: { id: string }) => [d.id, d]));
      expect(Object.keys(byId).sort()).toEqual([A.doc1, A.doc2, A.doc3Off, A.doc5NoFee].sort());
      expect(byId[A.doc1]).toMatchObject({
        available: true,
        unavailableReason: null,
        feeNewPaise: NEW_FEE,
        feeFollowUpPaise: FOLLOW_UP_FEE,
      });
      expect(byId[A.doc2]).toMatchObject({ feeNewPaise: DOC2_NEW_FEE });
      expect(byId[A.doc3Off]).toMatchObject({ available: false, unavailableReason: 'SWITCH_OFF' });
      expect(byId[A.doc5NoFee]).toMatchObject({ feeNewPaise: null, feeFollowUpPaise: null });
      expect(JSON.stringify(res.body)).not.toContain('@');

      const east = await http()
        .get('/opd/doctors')
        .set('Authorization', `Bearer ${A.tokens.recvEast}`);
      expect(east.body.items.map((d: { id: string }) => d.id)).toEqual([A.doc4EastOnly]);
      const other = await http()
        .get('/opd/doctors')
        .set('Authorization', `Bearer ${B.tokens.recv}`);
      expect(other.body.items.map((d: { id: string }) => d.id)).not.toContain(A.doc1);
    });
  });

  // ------------------------------------------------------------------- create and pay

  describe('POST /opd/visits (visit + bill + cash in one step)', () => {
    it('first visit: consultation + registration fee, paid in cash, receipt, token, queued, audited', async () => {
      const { res, patientId } = await visit(A);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        replayed: false,
        status: 'WAITING',
        visitType: 'NEW',
        branch: { id: A.main },
        patient: { id: patientId },
        doctor: { id: A.doc1 },
      });
      expect(res.body.token).toMatchObject({ label: `T${res.body.token.no}` });
      const bill = res.body.bill;
      expect(bill).toMatchObject({
        totalPaise: NEW_FEE + REG_FEE,
        paidPaise: NEW_FEE + REG_FEE,
        refundedPaise: 0,
        paymentStatus: 'PAID',
        taxPaise: 0,
      });
      expect(bill.billNumber).toMatch(/^\d{4}\/\d{5}$/);
      expect(
        bill.lines.map((l: { kind: string; lineTotalPaise: number }) => [l.kind, l.lineTotalPaise]),
      ).toEqual([
        ['CONSULTATION', NEW_FEE],
        ['REGISTRATION', REG_FEE],
      ]);
      expect(
        bill.lines.reduce((s: number, l: { lineTotalPaise: number }) => s + l.lineTotalPaise, 0),
      ).toBe(bill.totalPaise);
      expect(bill.payments).toHaveLength(1);
      expect(bill.payments[0]).toMatchObject({
        amountPaise: NEW_FEE + REG_FEE,
        paymentMode: { code: 'CASH' },
      });
      expect(bill.payments[0].receiptNumber).toMatch(/^\d{4}\/\d{5}$/);

      // Ledger, registration record and audit (field names and ids only).
      const ledger = await owner.ledgerEntry.findMany({
        where: { billId: bill.id },
        orderBy: { postedAt: 'asc' },
      });
      expect(ledger.map((l) => [l.entryType, l.amountPaise]).sort()).toEqual(
        [
          ['CHARGE', NEW_FEE + REG_FEE],
          ['PAYMENT', NEW_FEE + REG_FEE],
        ].sort(),
      );
      expect(
        await owner.patientRegistrationFee.count({ where: { patientId, voidedAt: null } }),
      ).toBe(1);
      const audits = await owner.auditLog.findMany({
        where: {
          tenantId: A.tenant,
          OR: [{ entityId: res.body.id }, { entityId: bill.payments[0].id }],
        },
      });
      expect(audits.map((a) => a.action).sort()).toEqual([
        'OPD_PAYMENT_RECEIVE',
        'OPD_VISIT_CREATE',
      ]);
      const auditText = JSON.stringify(audits);
      expect(auditText).not.toContain('Secret Name');
      expect(auditText).not.toContain('+91989');
      expect(audits.every((a) => a.actorUserId === A.users.recv && a.branchId === A.main)).toBe(
        true,
      );
    });

    it('second visit of the same patient: no registration fee again, even with another doctor', async () => {
      const first = await visit(A);
      expect(first.res.status).toBe(201);
      const second = await visit(A, { patient: first.patientId, doctor: A.doc2 });
      expect(second.res.status).toBe(201);
      expect(second.res.body.bill.totalPaise).toBe(DOC2_NEW_FEE);
      expect(second.res.body.bill.lines).toHaveLength(1);
      expect(second.res.body.token.no).toBeGreaterThan(first.res.body.token.no);
    });

    it('the branch comes from the token: a visit made by the East receptionist is an East visit', async () => {
      const { res } = await visit(A, { who: 'recvEast', doctor: A.doc4EastOnly });
      expect(res.status).toBe(201);
      expect(res.body.branch.id).toBe(A.east);
      const row = await owner.opdVisit.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.branchId).toBe(A.east);
      // And a Main-only doctor cannot be used from East.
      const wrong = await visit(A, { who: 'recvEast', doctor: A.doc1 });
      expect(wrong.res.status).toBe(400);
      expect(wrong.res.body.code).toBe('DOCTOR_NOT_IN_BRANCH');
    });

    it('refuses an unavailable doctor, a doctor of another branch, and unknown or foreign ids (nothing created)', async () => {
      const before = await counts(A);
      const off = await visit(A, { doctor: A.doc3Off });
      expect(off.res.status).toBe(400);
      expect(off.res.body).toMatchObject({ code: 'DOCTOR_UNAVAILABLE', reason: 'SWITCH_OFF' });
      const notHere = await visit(A, { doctor: A.doc4EastOnly });
      expect(notHere.res.body.code).toBe('DOCTOR_NOT_IN_BRANCH');
      const unknownDoctor = await visit(A, { doctor: 'no-such-doctor' });
      expect(unknownDoctor.res.status).toBe(404);
      expect(unknownDoctor.res.body.code).toBe('DOCTOR_NOT_FOUND');
      const foreignDoctor = await visit(A, { doctor: B.doc1 });
      expect(foreignDoctor.res.status).toBe(404);
      expect(foreignDoctor.res.body).toEqual(unknownDoctor.res.body);
      const foreignPatient = await visit(A, { patient: await newPatient(B) });
      expect(foreignPatient.res.status).toBe(404);
      const unknownPatient = await visit(A, { patient: 'no-such-patient' });
      expect(unknownPatient.res.body).toEqual(foreignPatient.res.body);
      const inactive = await visit(A, { patient: await newPatient(A, { isActive: false }) });
      expect(inactive.res.status).toBe(404);
      expect(await counts(A)).toEqual(before);
    });

    it('a doctor without a configured fee blocks billing instead of billing zero', async () => {
      const before = await counts(A);
      const { res } = await visit(A, { doctor: A.doc5NoFee });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'FEE_NOT_CONFIGURED', what: 'CONSULTATION' });
      expect(await counts(A)).toEqual(before);
    });

    it('tax switched on in the hospital settings is refused (501) until tax billing exists', async () => {
      await owner.opdSettings.update({ where: { tenantId: A.tenant }, data: { taxEnabled: true } });
      try {
        const before = await counts(A);
        const { res } = await visit(A);
        expect(res.status).toBe(501);
        expect(res.body.code).toBe('TAX_NOT_SUPPORTED');
        expect(await counts(A)).toEqual(before);
      } finally {
        await owner.opdSettings.update({
          where: { tenantId: A.tenant },
          data: { taxEnabled: false },
        });
      }
    });

    it('payment modes: unknown or inactive mode and a missing reference are refused; UPI with a reference works', async () => {
      const patientId = await newPatient(A);
      const base = { patientId, doctorProfileId: A.doc1, visitType: 'NEW' };
      const before = await counts(A);
      const unknown = await create(A, 'recv', {
        ...base,
        idempotencyKey: uniq('KEY-AAAA'),
        paymentModeCode: 'NOPE',
      });
      expect([unknown.status, unknown.body.code]).toEqual([400, 'PAYMENT_MODE_NOT_AVAILABLE']);
      const inactive = await create(A, 'recv', {
        ...base,
        idempotencyKey: uniq('KEY-AAAA'),
        paymentModeCode: 'OLD',
      });
      expect(inactive.body.code).toBe('PAYMENT_MODE_NOT_AVAILABLE');
      const noRef = await create(A, 'recv', {
        ...base,
        idempotencyKey: uniq('KEY-AAAA'),
        paymentModeCode: 'UPI',
      });
      expect([noRef.status, noRef.body.code]).toEqual([400, 'REFERENCE_REQUIRED']);
      const blankRef = await create(A, 'recv', {
        ...base,
        idempotencyKey: uniq('KEY-AAAA'),
        paymentModeCode: 'UPI',
        referenceNo: '   ',
      });
      expect(blankRef.body.code).toBe('REFERENCE_REQUIRED');
      expect(await counts(A)).toEqual(before);
      const ok = await create(A, 'recv', {
        ...base,
        idempotencyKey: uniq('KEY-AAAA'),
        paymentModeCode: 'UPI',
        referenceNo: 'UTR-998877',
      });
      expect(ok.status).toBe(201);
      expect(ok.body.bill.payments[0]).toMatchObject({
        paymentMode: { code: 'UPI' },
        referenceNo: 'UTR-998877',
      });
    });
  });

  // ------------------------------------------------------------ follow-up, free window

  describe('follow-up visits', () => {
    it('inside the free window: zero bill, settled, no payment, still gets a bill number and a token', async () => {
      const first = await visit(A);
      await complete(first.res.body.id);
      const { res } = await visit(A, { patient: first.patientId, type: 'FOLLOW_UP' });
      expect(res.status).toBe(201);
      expect(res.body.previousVisitId).toBe(first.res.body.id);
      expect(res.body.status).toBe('WAITING');
      expect(res.body.token).not.toBeNull();
      expect(res.body.bill).toMatchObject({
        totalPaise: 0,
        paidPaise: 0,
        paymentStatus: 'PAID',
        payments: [],
      });
      expect(res.body.bill.billNumber).toMatch(/^\d{4}\/\d{5}$/);
      expect(res.body.bill.lines).toEqual([
        expect.objectContaining({
          kind: 'CONSULTATION',
          unitPricePaise: 0,
          pricingNote: 'FOLLOW_UP_FREE_WINDOW',
        }),
      ]);
      // No money moved: no payment, no ledger row.
      expect(await owner.payment.count({ where: { billId: res.body.bill.id } })).toBe(0);
      expect(await owner.ledgerEntry.count({ where: { billId: res.body.bill.id } })).toBe(0);
      const audits = await owner.auditLog.findMany({ where: { entityId: res.body.id } });
      expect(audits.map((a) => a.action)).toEqual(['OPD_VISIT_CREATE']);
    });

    it('outside the window the follow-up fee applies; the window is the hospital setting', async () => {
      const first = await visit(A);
      await complete(first.res.body.id);
      clock.set(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
      const late = await visit(A, { patient: first.patientId, type: 'FOLLOW_UP' });
      expect(late.res.status).toBe(201);
      expect(late.res.body.bill.totalPaise).toBe(FOLLOW_UP_FEE);
      expect(late.res.body.bill.lines[0].pricingNote).toBeNull();

      // The window is a setting: widen it and the same day-count becomes free.
      await owner.opdSettings.update({
        where: { tenantId: A.tenant },
        data: { followUpFreeDays: 30 },
      });
      try {
        const first2 = await visit(A);
        await complete(first2.res.body.id);
        clock.set(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
        const inside = await visit(A, { patient: first2.patientId, type: 'FOLLOW_UP' });
        expect(inside.res.body.bill.totalPaise).toBe(0);
      } finally {
        await owner.opdSettings.update({
          where: { tenantId: A.tenant },
          data: { followUpFreeDays: 7 },
        });
      }
    });

    it('a follow-up needs a completed earlier visit with the same doctor', async () => {
      const first = await visit(A);
      await complete(first.res.body.id);
      const other = await visit(A, { patient: first.patientId, doctor: A.doc2, type: 'FOLLOW_UP' });
      expect(other.res.status).toBe(400);
      expect(other.res.body.code).toBe('FOLLOW_UP_NEEDS_PREVIOUS_VISIT');
      const waiting = await visit(A);
      const notCompleted = await visit(A, { patient: waiting.patientId, type: 'FOLLOW_UP' });
      expect(notCompleted.res.body.code).toBe('FOLLOW_UP_NEEDS_PREVIOUS_VISIT');
    });
  });

  // ------------------------------------------------------------- free repeat-visit window

  describe('free repeat visit with the same doctor (hospital setting, hours)', () => {
    const HOUR = 60 * 60 * 1000;
    async function withWindow(hours: number, run: () => Promise<void>) {
      await owner.opdSettings.update({
        where: { tenantId: A.tenant },
        data: { repeatVisitFreeHours: hours },
      });
      try {
        await run();
      } finally {
        await owner.opdSettings.update({
          where: { tenantId: A.tenant },
          data: { repeatVisitFreeHours: 0 },
        });
      }
    }
    const queuedAtOf = async (visitId: string) =>
      (await owner.opdVisit.findUniqueOrThrow({ where: { id: visitId } })).queuedAt!;
    const previewNew = (patientId: string, doctorProfileId: string, visitType = 'NEW') =>
      preview(A, 'recv', { patientId, doctorProfileId, visitType });

    it('the setting is off by default: a second visit the same day is charged in full', async () => {
      const first = await visit(A);
      const second = await visit(A, { patient: first.patientId });
      expect(second.res.status).toBe(201);
      expect(second.res.body.bill.totalPaise).toBe(NEW_FEE);
    });

    it('inside the window the same doctor is free even though "New" was picked, and it is audited', async () => {
      await withWindow(24, async () => {
        const first = await visit(A);
        expect(first.res.body.bill.totalPaise).toBe(NEW_FEE + REG_FEE);
        clock.set(new Date(Date.now() + 2 * HOUR));
        const shown = await previewNew(first.patientId, A.doc1);
        expect(shown.body).toMatchObject({
          totalPaise: 0,
          repeatVisitFree: true,
          followUpFree: false,
        });
        expect(shown.body.lines[0]).toMatchObject({
          unitPricePaise: 0,
          pricingNote: 'REPEAT_VISIT_FREE_WINDOW',
        });
        const second = await create(A, 'recv', {
          patientId: first.patientId,
          doctorProfileId: A.doc1,
          visitType: 'NEW',
          idempotencyKey: uniq('KEY-REPEAT'),
          expectedTotalPaise: 0,
        });
        expect(second.status).toBe(201);
        expect(second.body.bill.totalPaise).toBe(0);
        expect(second.body.bill.lines[0].pricingNote).toBe('REPEAT_VISIT_FREE_WINDOW');
        // A zero total counts as settled: the visit is in the queue.
        const row = await owner.opdVisit.findUniqueOrThrow({ where: { id: second.body.id } });
        expect(row.status).toBe('WAITING');
        const audit = await owner.auditLog.findFirstOrThrow({
          where: { tenantId: A.tenant, entityId: second.body.id },
        });
        expect(audit.metadata).toMatchObject({ freeRepeatVisit: true, totalPaise: 0 });
      });
    });

    it('a different doctor is still charged, and so is a different patient', async () => {
      await withWindow(24, async () => {
        const first = await visit(A);
        const otherDoctor = await visit(A, { patient: first.patientId, doctor: A.doc2 });
        expect(otherDoctor.res.body.bill.totalPaise).toBe(DOC2_NEW_FEE);
        const otherPatient = await visit(A);
        expect(otherPatient.res.body.bill.totalPaise).toBe(NEW_FEE + REG_FEE);
      });
    });

    it('the window ends exactly at the setting: 1 ms before it is free, at the limit it is charged', async () => {
      await withWindow(3, async () => {
        const first = await visit(A);
        const at = (await queuedAtOf(first.res.body.id)).getTime();
        clock.set(new Date(at + 3 * HOUR - 1));
        expect((await previewNew(first.patientId, A.doc1)).body.totalPaise).toBe(0);
        clock.set(new Date(at + 3 * HOUR));
        expect((await previewNew(first.patientId, A.doc1)).body).toMatchObject({
          totalPaise: NEW_FEE,
          repeatVisitFree: false,
        });
      });
    });

    it('a free repeat visit does not extend the window (it counts from the last PAID consultation)', async () => {
      await withWindow(3, async () => {
        const first = await visit(A);
        const at = (await queuedAtOf(first.res.body.id)).getTime();
        clock.set(new Date(at + 2 * HOUR));
        const free = await visit(A, { patient: first.patientId });
        expect(free.res.body.bill.totalPaise).toBe(0);
        // 4 hours after the paid visit is 2 hours after the free one, still outside the window.
        clock.set(new Date(at + 4 * HOUR));
        const later = await visit(A, { patient: first.patientId });
        expect(later.res.body.bill.totalPaise).toBe(NEW_FEE);
      });
    });

    it('a cancelled earlier visit does not give a free one', async () => {
      await withWindow(24, async () => {
        const first = await visit(A);
        // Step 6a: a waiting visit is cancelled only through an APPROVED cancellation request
        // (asked by one person, approved by another), all in one transaction.
        await asOwner(async (c) => {
          await c.query('BEGIN');
          await c.query(
            `INSERT INTO refund_requests (id, tenant_id, branch_id, bill_id, visit_id, request_type,
                                          amount_paise, reason, requested_by, idempotency_key)
             SELECT gen_random_uuid()::text, b.tenant_id, b.branch_id, b.id, b.visit_id,
                    'CANCEL_VISIT', 0, 'test', $2, 'cancel-' || b.id
               FROM bills b WHERE b.visit_id = $1`,
            [first.res.body.id, A.users.recv],
          );
          await c.query(
            `UPDATE refund_requests
                SET status = 'APPROVED', decided_by = $2, decided_at = now()
              WHERE visit_id = $1`,
            [first.res.body.id, A.users.nurse],
          );
          await c.query(
            `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='test', updated_at=now() WHERE id=$1`,
            [first.res.body.id],
          );
          await c.query('COMMIT');
        });
        const again = await visit(A, { patient: first.patientId });
        expect(again.res.body.bill.totalPaise).toBe(NEW_FEE);
      });
    });

    it('the setting is per hospital: another hospital with window 0 still charges', async () => {
      await withWindow(24, async () => {
        const firstB = await visit(B);
        const secondB = await visit(B, { patient: firstB.patientId });
        expect(secondB.res.body.bill.totalPaise).toBe(NEW_FEE);
      });
    });

    it('a follow-up inside its own window keeps its follow-up label (that rule comes first)', async () => {
      await withWindow(24, async () => {
        const first = await visit(A);
        await complete(first.res.body.id);
        const res = await previewNew(first.patientId, A.doc1, 'FOLLOW_UP');
        expect(res.body).toMatchObject({
          totalPaise: 0,
          followUpFree: true,
          repeatVisitFree: false,
        });
      });
    });

    it('a follow-up outside its window but inside the repeat window is free as a repeat visit', async () => {
      await owner.opdSettings.update({
        where: { tenantId: A.tenant },
        data: { followUpFreeDays: 0 },
      });
      try {
        await withWindow(48, async () => {
          const first = await visit(A);
          await complete(first.res.body.id);
          clock.set(new Date(Date.now() + 25 * HOUR));
          const res = await previewNew(first.patientId, A.doc1, 'FOLLOW_UP');
          expect(res.body).toMatchObject({ totalPaise: 0, repeatVisitFree: true });
        });
      } finally {
        await owner.opdSettings.update({
          where: { tenantId: A.tenant },
          data: { followUpFreeDays: 7 },
        });
      }
    });
  });

  // ----------------------------------------------------------------------- payment modes

  describe('GET /opd/payment-modes', () => {
    const get = (who: string) =>
      http().get('/opd/payment-modes').set('Authorization', `Bearer ${A.tokens[who]}`);

    it('lists the ACTIVE modes (no ids), the default first, with the default code and the line limit', async () => {
      const res = await get('recv');
      expect(res.status).toBe(200);
      expect(res.body.items.map((m: { code: string }) => m.code)).toEqual(['CASH', 'CARD', 'UPI']);
      expect(res.body.items).toEqual([
        { code: 'CASH', name: 'CASH', requiresReference: false },
        { code: 'CARD', name: 'CARD', requiresReference: false },
        { code: 'UPI', name: 'UPI', requiresReference: true },
      ]);
      expect(res.body.defaultCode).toBe('CASH');
      expect(res.body.maxLines).toBe(4);
      // inactive mode OLD is not listed and no internal ids leak
      expect(JSON.stringify(res.body)).not.toContain('OLD');
      expect(JSON.stringify(res.body)).not.toContain(A.cashId);
    });

    it('needs opd.billing.collect: nurse, doctor and users without it are refused; no token is 401', async () => {
      for (const who of ['nurse', 'doc1', 'nobody']) {
        expect((await get(who)).status).toBe(403);
      }
      expect((await http().get('/opd/payment-modes')).status).toBe(401);
    });

    it('is per hospital: another hospital sees only its own modes', async () => {
      await owner.paymentMode.create({
        data: { tenantId: B.tenant, code: 'WALLET', name: 'Wallet', requiresReference: false },
      });
      const b = await http()
        .get('/opd/payment-modes')
        .set('Authorization', `Bearer ${B.tokens.recv}`);
      expect(b.body.items.map((m: { code: string }) => m.code)).toContain('WALLET');
      expect((await get('recv')).body.items.map((m: { code: string }) => m.code)).not.toContain(
        'WALLET',
      );
    });
  });

  // ----------------------------------------------------------- split payment, one receipt

  describe('split payment: several modes, ONE receipt (Step 5a-1)', () => {
    const TOTAL = NEW_FEE + REG_FEE; // a brand-new patient with doctor 1
    const upi = (amountPaise: number, referenceNo = 'UTR-5551') => ({
      paymentModeCode: 'UPI',
      amountPaise,
      referenceNo,
    });
    const cash = (amountPaise: number) => ({ paymentModeCode: 'CASH', amountPaise });
    async function split(
      payments: unknown,
      o: { patientId?: string; key?: string; extra?: Record<string, unknown>; who?: string } = {},
    ) {
      const patientId = o.patientId ?? (await newPatient(A));
      const res = await create(A, o.who ?? 'recv', {
        patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: o.key ?? uniq('KEY-SPLIT'),
        payments,
        ...o.extra,
      });
      return { res, patientId };
    }

    it('UPI + cash on one bill: one receipt number, two payments, bill PAID, visit in the queue', async () => {
      const { res } = await split([upi(30_000), cash(TOTAL - 30_000)]);
      expect(res.status).toBe(201);
      const bill = res.body.bill;
      expect(bill).toMatchObject({ totalPaise: TOTAL, paidPaise: TOTAL, paymentStatus: 'PAID' });
      expect(bill.payments).toHaveLength(2);
      expect(
        bill.payments.map((p: { paymentMode: { code: string }; amountPaise: number }) => [
          p.paymentMode.code,
          p.amountPaise,
        ]),
      ).toEqual([
        ['UPI', 30_000],
        ['CASH', TOTAL - 30_000],
      ]);
      expect(bill.payments[0].referenceNo).toBe('UTR-5551');
      // ONE receipt number for both payments, listed once on the bill
      expect(bill.payments[0].receiptNumber).toBe(bill.payments[1].receiptNumber);
      expect(bill.receipts).toEqual([
        expect.objectContaining({
          receiptNumber: bill.payments[0].receiptNumber,
          totalPaise: TOTAL,
        }),
      ]);
      expect(res.body.status).toBe('WAITING');
      expect(res.body.token.no).toBeGreaterThan(0);

      // In the database: one receipt row, two payments on it, two ledger payment entries.
      const receipts = await owner.receipt.findMany({ where: { billId: bill.id } });
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.totalPaise).toBe(TOTAL);
      const payments = await owner.payment.findMany({ where: { billId: bill.id } });
      expect(payments.map((p) => p.receiptId)).toEqual([receipts[0]!.id, receipts[0]!.id]);
      expect(
        await owner.ledgerEntry.count({ where: { billId: bill.id, entryType: 'PAYMENT' } }),
      ).toBe(2);
    });

    it('takes exactly ONE receipt number per split (no gap, no extra number)', async () => {
      const first = await split([upi(30_000), cash(TOTAL - 30_000)]);
      const last = suffix(first.res.body.bill.receipts[0].receiptNumber);
      const next = await visit(A);
      expect(suffix(next.res.body.bill.receipts[0].receiptNumber)).toBe(last + 1);
    });

    it('audit: one entry per payment, with the mode and amount but never the reference number', async () => {
      const { res } = await split([upi(30_000, 'UTR-SECRET-77'), cash(TOTAL - 30_000)]);
      const rows = await owner.auditLog.findMany({
        where: {
          tenantId: A.tenant,
          action: 'OPD_PAYMENT_RECEIVE',
          metadata: { path: ['billId'], equals: res.body.bill.id },
        },
      });
      expect(rows).toHaveLength(2);
      expect(
        rows.map((r) => (r.metadata as { paymentModeCode: string }).paymentModeCode).sort(),
      ).toEqual(['CASH', 'UPI']);
      expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('UTR-SECRET-77');
    });

    it('three modes work (CASH + UPI + CARD) and the single-mode request still works as before', async () => {
      const three = await split([
        cash(20_000),
        upi(20_000),
        { paymentModeCode: 'CARD', amountPaise: TOTAL - 40_000 },
      ]);
      expect(three.res.status).toBe(201);
      expect(three.res.body.bill.payments).toHaveLength(3);
      expect(three.res.body.bill.receipts).toHaveLength(1);
      const single = await visit(A);
      expect(single.res.body.bill.payments).toHaveLength(1);
      expect(single.res.body.bill.receipts).toHaveLength(1);
    });

    it('amounts that do not add up to the total are refused (400) and nothing is stored or numbered', async () => {
      const before = await counts(A);
      for (const [lines, paid] of [
        [[upi(30_000), cash(20_000)], 50_000],
        [[upi(30_000), cash(TOTAL)], TOTAL + 30_000],
        [[cash(TOTAL - 1)], TOTAL - 1],
      ] as const) {
        const { res } = await split(lines);
        expect([res.status, res.body.code]).toEqual([400, 'PAYMENT_SUM_MISMATCH']);
        expect(res.body).toMatchObject({ totalPaise: TOTAL, paidPaise: paid });
      }
      expect(await counts(A)).toEqual(before);
    });

    it('one mode twice, an unknown or inactive mode, and a missing UPI reference are refused', async () => {
      const before = await counts(A);
      const dup = await split([cash(30_000), cash(TOTAL - 30_000)]);
      expect([dup.res.status, dup.res.body.code]).toEqual([400, 'PAYMENT_MODE_DUPLICATE']);
      const unknown = await split([
        cash(30_000),
        { paymentModeCode: 'NOPE', amountPaise: TOTAL - 30_000 },
      ]);
      expect(unknown.res.body.code).toBe('PAYMENT_MODE_NOT_AVAILABLE');
      const inactive = await split([
        cash(30_000),
        { paymentModeCode: 'OLD', amountPaise: TOTAL - 30_000 },
      ]);
      expect(inactive.res.body.code).toBe('PAYMENT_MODE_NOT_AVAILABLE');
      const noRef = await split([
        { paymentModeCode: 'UPI', amountPaise: 30_000 },
        cash(TOTAL - 30_000),
      ]);
      expect([noRef.res.status, noRef.res.body.code]).toEqual([400, 'REFERENCE_REQUIRED']);
      const blankRef = await split([upi(30_000, '   '), cash(TOTAL - 30_000)]);
      expect(blankRef.res.body.code).toBe('REFERENCE_REQUIRED');
      expect(await counts(A)).toEqual(before);
    });

    it('bad shapes are refused (400): empty, too many lines, zero, negative, fraction, text, extra fields', async () => {
      const before = await counts(A);
      const lines5 = [1, 2, 3, 4, 5].map((n) => cash(n));
      const bad: unknown[] = [
        [],
        lines5,
        [cash(0), upi(TOTAL)],
        [{ paymentModeCode: 'CASH', amountPaise: -5 }],
        [{ paymentModeCode: 'CASH', amountPaise: 10.5 }],
        [{ paymentModeCode: 'CASH', amountPaise: '600' }],
        [{ paymentModeCode: 'CASH', amountPaise: 2_147_483_648 }],
        [{ amountPaise: TOTAL }],
        [{ paymentModeCode: 'CASH', amountPaise: TOTAL, receiptNumber: 'FAKE/1' }],
        [{ paymentModeCode: 'CASH', amountPaise: TOTAL, paymentId: 'x' }],
        'CASH',
        { paymentModeCode: 'CASH', amountPaise: TOTAL },
        null,
      ];
      for (const lines of bad) {
        const { res } = await split(lines);
        expect([lines, res.status]).toEqual([lines, 400]);
      }
      expect(await counts(A)).toEqual(before);
    });

    it('more lines than the limit are refused by the input check itself (5 different modes, not by the mode rules)', async () => {
      const five = ['CASH', 'UPI', 'CARD', 'M4', 'M5'].map((paymentModeCode) => ({
        paymentModeCode,
        amountPaise: 1,
        referenceNo: 'R',
      }));
      const { res } = await split(five);
      expect(res.status).toBe(400);
      // A validation message about the list, not one of the payment rules (those carry a code).
      expect(res.body.code).toBeUndefined();
      expect(JSON.stringify(res.body.message)).toMatch(/payments/);
    });

    it('a payments list together with paymentModeCode or referenceNo is refused (one way to say it)', async () => {
      const before = await counts(A);
      for (const extra of [{ paymentModeCode: 'CASH' }, { referenceNo: 'UTR-1' }]) {
        const { res } = await split([cash(TOTAL)], { extra });
        expect([res.status, res.body.code]).toEqual([400, 'PAYMENT_FIELDS_CONFLICT']);
      }
      expect(await counts(A)).toEqual(before);
    });

    it('a free visit takes no money: a payments list for it is refused, no list creates it free', async () => {
      const first = await visit(A);
      await complete(first.res.body.id);
      const before = await counts(A);
      const refused = await create(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'FOLLOW_UP',
        idempotencyKey: uniq('KEY-FREE'),
        payments: [cash(100)],
      });
      expect([refused.status, refused.body.code]).toEqual([400, 'PAYMENT_NOT_EXPECTED']);
      expect(await counts(A)).toEqual(before);
      const free = await visit(A, { patient: first.patientId, type: 'FOLLOW_UP' });
      expect(free.res.status).toBe(201);
      expect(free.res.body.bill.receipts).toEqual([]);
      expect(free.res.body.bill.payments).toEqual([]);
    });

    it('a changed price is still refused first (PRICE_CHANGED), even when the split adds up to the old total', async () => {
      const before = await counts(A);
      const { res } = await split([upi(30_000), cash(TOTAL - 30_000)], {
        extra: { expectedTotalPaise: TOTAL - 1 },
      });
      expect([res.status, res.body.code]).toEqual([409, 'PRICE_CHANGED']);
      expect(await counts(A)).toEqual(before);
    });

    it('same key again = same visit and receipt (200); the same key with other amounts or modes = 409', async () => {
      const key = uniq('KEY-SPLIT');
      const lines = [upi(30_000), cash(TOTAL - 30_000)];
      const first = await split(lines, { key });
      expect(first.res.status).toBe(201);
      const before = await counts(A);
      const again = await create(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: key,
        payments: [cash(TOTAL - 30_000), upi(30_000)], // same split, other order
      });
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.id).toBe(first.res.body.id);
      expect(again.body.bill.receipts).toEqual(first.res.body.bill.receipts);
      expect(await counts(A)).toEqual(before);
      for (const other of [
        [upi(10_000), cash(TOTAL - 10_000)],
        [{ paymentModeCode: 'CARD', amountPaise: 30_000 }, cash(TOTAL - 30_000)],
        [cash(TOTAL)],
      ]) {
        const reused = await create(A, 'recv', {
          patientId: first.patientId,
          doctorProfileId: A.doc1,
          visitType: 'NEW',
          idempotencyKey: key,
          payments: other,
        });
        expect([reused.status, reused.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      }
      const single = await create(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: key,
        paymentModeCode: 'CASH',
      });
      expect(single.status).toBe(409);
      expect(await counts(A)).toEqual(before);
    });

    it('PARALLEL double submit of one split (8 at once): one visit, ONE receipt, two payments', async () => {
      // Several rounds: the race (a request pricing just after the winner charged the
      // registration fee) is timing dependent, so one round is not enough to trust.
      for (let round = 0; round < 4; round += 1) {
        const key = uniq('KEY-SPLITP');
        const patientId = await newPatient(A);
        const body = {
          patientId,
          doctorProfileId: A.doc1,
          visitType: 'NEW',
          idempotencyKey: key,
          expectedTotalPaise: TOTAL,
          payments: [upi(30_000), cash(TOTAL - 30_000)],
        };
        const results = await Promise.all(Array.from({ length: 8 }, () => create(A, 'recv', body)));
        for (const r of results) {
          expect(r.body.code).toBeUndefined(); // an error would show its code here
          expect([200, 201]).toContain(r.status);
        }
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
        expect(await owner.opdVisit.count({ where: { patientId } })).toBe(1);
        const billId = results[0]!.body.bill.id;
        expect(await owner.receipt.count({ where: { billId } })).toBe(1);
        expect(await owner.payment.count({ where: { billId } })).toBe(2);
      }
    });

    it('permissions: nurse, doctor and users without the collect permission cannot send a split (403)', async () => {
      const before = await counts(A);
      for (const who of ['nurse', 'doc1', 'nobody']) {
        const { res } = await split([upi(30_000), cash(TOTAL - 30_000)], { who });
        expect(res.status).toBe(403);
      }
      expect(await counts(A)).toEqual(before);
    });

    it('the preview takes no payment fields, and money views show receipts only with opd.billing.read', async () => {
      const prev = await preview(A, 'recv', {
        patientId: await newPatient(A),
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        payments: [cash(TOTAL)],
      });
      expect(prev.status).toBe(400);
      const { res } = await split([upi(30_000), cash(TOTAL - 30_000)]);
      const asNurse = await http()
        .get(`/opd/visits/${res.body.id}`)
        .set('Authorization', `Bearer ${A.tokens.nurse}`);
      expect(asNurse.status).toBe(200);
      expect(asNurse.body.bill).toBeUndefined();
      expect(JSON.stringify(asNurse.body)).not.toContain('receipt');
    });

    it('another hospital cannot see this receipt (404) and its own numbers are separate', async () => {
      const { res } = await split([upi(30_000), cash(TOTAL - 30_000)]);
      const other = await http()
        .get(`/opd/visits/${res.body.id}`)
        .set('Authorization', `Bearer ${B.tokens.recv}`);
      expect(other.status).toBe(404);
      expect(JSON.stringify(other.body)).not.toContain(res.body.bill.receipts[0].receiptNumber);
    });
  });

  // ------------------------------------------------------------------------ idempotency

  describe('idempotency (a double click never bills or charges twice)', () => {
    it('the same key returns the same visit, bill and receipt (200) and creates nothing new', async () => {
      const key = uniq('KEY-SAME');
      const first = await visit(A, { key });
      expect(first.res.status).toBe(201);
      const before = await counts(A);
      const again = await create(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: key,
      });
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.id).toBe(first.res.body.id);
      expect(again.body.bill.billNumber).toBe(first.res.body.bill.billNumber);
      expect(again.body.bill.payments[0].receiptNumber).toBe(
        first.res.body.bill.payments[0].receiptNumber,
      );
      expect(again.body.token).toEqual(first.res.body.token);
      expect(await counts(A)).toEqual(before);
    });

    it('the same key with a different request is refused (409), not silently replayed', async () => {
      const key = uniq('KEY-SAME');
      const first = await visit(A, { key });
      const otherDoctor = await create(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc2,
        visitType: 'NEW',
        idempotencyKey: key,
      });
      expect([otherDoctor.status, otherDoctor.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      const otherPatient = await create(A, 'recv', {
        patientId: await newPatient(A),
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: key,
      });
      expect(otherPatient.status).toBe(409);
      const otherBranch = await create(A, 'recvEast', {
        patientId: first.patientId,
        doctorProfileId: A.doc4EastOnly,
        visitType: 'NEW',
        idempotencyKey: key,
      });
      expect(otherBranch.status).toBe(409);
    });

    it('keys are per hospital: another hospital may use the same key', async () => {
      const key = uniq('KEY-SAME');
      expect((await visit(A, { key })).res.status).toBe(201);
      expect((await visit(B, { key })).res.status).toBe(201);
    });

    it('PARALLEL double submit (8 at once): exactly one visit, one bill, one payment', async () => {
      const key = uniq('KEY-PARA');
      const patientId = await newPatient(A);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          create(A, 'recv', {
            patientId,
            doctorProfileId: A.doc1,
            visitType: 'NEW',
            idempotencyKey: key,
          }),
        ),
      );
      for (const r of results) {
        expect([200, 201]).toContain(r.status);
      }
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await owner.opdVisit.count({ where: { patientId } })).toBe(1);
      expect(await owner.bill.count({ where: { idempotencyKey: key, tenantId: A.tenant } })).toBe(
        1,
      );
      expect(
        await owner.payment.count({ where: { idempotencyKey: key, tenantId: A.tenant } }),
      ).toBe(1);
    });

    it('PARALLEL visits of one NEW patient with two doctors: the registration fee is charged once', async () => {
      const patientId = await newPatient(A);
      const results = await Promise.all(
        [A.doc1, A.doc2].map((doctor) =>
          create(A, 'recv', {
            patientId,
            doctorProfileId: doctor,
            visitType: 'NEW',
            idempotencyKey: uniq('KEY-REG'),
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const regLines = results.flatMap((r) =>
        r.body.bill.lines.filter((l: { kind: string }) => l.kind === 'REGISTRATION'),
      );
      expect(regLines).toHaveLength(1);
      expect(
        await owner.patientRegistrationFee.count({ where: { patientId, voidedAt: null } }),
      ).toBe(1);
    });
  });

  // ----------------------------------------------------------------------- numbering

  describe('numbers, tokens and rollback', () => {
    it('20 parallel visits: bill numbers, receipt numbers and tokens are distinct and without gaps', async () => {
      const patients = await Promise.all(Array.from({ length: 20 }, () => newPatient(A)));
      const results = await Promise.all(
        patients.map((patientId, i) =>
          create(A, 'recv', {
            patientId,
            doctorProfileId: i % 2 ? A.doc1 : A.doc2,
            visitType: 'NEW',
            idempotencyKey: uniq('KEY-LOAD'),
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
      const contiguous = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return (
          new Set(sorted).size === sorted.length &&
          sorted[sorted.length - 1]! - sorted[0]! === sorted.length - 1
        );
      };
      expect(contiguous(results.map((r) => suffix(r.body.bill.billNumber)))).toBe(true);
      expect(contiguous(results.map((r) => suffix(r.body.bill.payments[0].receiptNumber)))).toBe(
        true,
      );
      expect(contiguous(results.map((r) => r.body.token.no as number))).toBe(true);
    });

    it('a failed request leaves no gap: refused requests and a rollback after numbers were taken', async () => {
      const first = await visit(A);
      const lastBill = suffix(first.res.body.bill.billNumber);
      const lastToken = first.res.body.token.no as number;
      // Refused before anything is written.
      await visit(A, { doctor: A.doc3Off });
      await create(A, 'recv', {
        patientId: await newPatient(A),
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-AAAA'),
        paymentModeCode: 'UPI',
      });
      // Fails AFTER the bill number was taken (the receipt step blows up): the whole transaction rolls back.
      const { NumberSeriesService } = await import('../numbering/number-series.service');
      const series = app.get(NumberSeriesService, { strict: false });
      const real = series.allocate.bind(series);
      const spy = jest
        .spyOn(series, 'allocate')
        .mockImplementationOnce(real)
        .mockRejectedValueOnce(new Error('boom'));
      const before = await counts(A);
      const failed = await visit(A);
      spy.mockRestore();
      expect(failed.res.status).toBe(500);
      expect(await counts(A)).toEqual(before);
      const next = await visit(A);
      expect(suffix(next.res.body.bill.billNumber)).toBe(lastBill + 1);
      expect(next.res.body.token.no).toBe(lastToken + 1);
    });

    it('the token restarts at 1 after midnight in the hospital time zone, and the visit date follows', async () => {
      // 23:59 in India on 10 June 2026 (18:29 UTC) and two minutes later (00:01 on 11 June).
      clock.set(new Date('2026-06-10T18:29:00.000Z'));
      const before = await visit(A);
      expect(before.res.body.visitDate).toBe('2026-06-10');
      expect(before.res.body.token.date).toBe('2026-06-10');
      clock.set(new Date('2026-06-10T18:31:00.000Z'));
      const after = await visit(A);
      expect(after.res.body.visitDate).toBe('2026-06-11');
      expect(after.res.body.token).toMatchObject({ date: '2026-06-11', no: 1 });
      // Another branch has its own series.
      const east = await visit(A, { who: 'recvEast', doctor: A.doc4EastOnly });
      expect(east.res.body.token).toMatchObject({ date: '2026-06-11', no: 1 });
    });
  });

  // ---------------------------------------------------------------------------- reads

  describe('reads', () => {
    it('receptionist sees the bill with lines and payments; nurse and doctor never see money', async () => {
      const { res } = await visit(A);
      const id = res.body.id;
      const recv = await http()
        .get(`/opd/visits/${id}`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(recv.status).toBe(200);
      expect(recv.body.bill.lines).toHaveLength(2);
      expect(recv.body.bill.payments).toHaveLength(1);
      const nurse = await http()
        .get(`/opd/visits/${id}`)
        .set('Authorization', `Bearer ${A.tokens.nurse}`);
      expect(nurse.status).toBe(200);
      expect(nurse.body).not.toHaveProperty('bill');
      expect(JSON.stringify(nurse.body)).not.toMatch(/paise|receipt|billNumber/i);
      const doctor = await http()
        .get(`/opd/visits/${id}`)
        .set('Authorization', `Bearer ${A.tokens.doc1}`);
      expect(doctor.status).toBe(200);
      expect(doctor.body).not.toHaveProperty('bill');
    });

    it("a doctor reads only their own visits; other doctors' visits are 404", async () => {
      const mine = await visit(A, { doctor: A.doc1 });
      const theirs = await visit(A, { doctor: A.doc2 });
      expect(
        (
          await http()
            .get(`/opd/visits/${theirs.res.body.id}`)
            .set('Authorization', `Bearer ${A.tokens.doc1}`)
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .get(`/opd/visits/${mine.res.body.id}`)
            .set('Authorization', `Bearer ${A.tokens.doc2}`)
        ).status,
      ).toBe(404);
      // The nurse (no doctor profile) sees the whole branch.
      expect(
        (
          await http()
            .get(`/opd/visits/${theirs.res.body.id}`)
            .set('Authorization', `Bearer ${A.tokens.nurse}`)
        ).status,
      ).toBe(200);
    });

    it('visits and bills stay in their branch and hospital: other branch, other hospital, unknown id are all 404', async () => {
      const { res } = await visit(A);
      const id = res.body.id;
      const east = await http()
        .get(`/opd/visits/${id}`)
        .set('Authorization', `Bearer ${A.tokens.recvEast}`);
      const foreign = await http()
        .get(`/opd/visits/${id}`)
        .set('Authorization', `Bearer ${B.tokens.recv}`);
      const unknown = await http()
        .get('/opd/visits/no-such-id')
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      for (const r of [east, foreign, unknown]) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(unknown.body);
      }
      // A token for the same user but the OTHER branch cannot read it either.
      const switched = tokenService.signHospitalAccess({
        tenantId: A.tenant,
        userId: A.users.recv,
        branchId: A.east,
      });
      expect(
        (await http().get(`/opd/visits/${id}`).set('Authorization', `Bearer ${switched}`)).status,
      ).toBe(403);
    });

    it("lists one patient's visits of the active branch, newest first, with a bill summary and a page cap", async () => {
      const first = await visit(A, { doctor: A.doc1 });
      const second = await visit(A, { patient: first.patientId, doctor: A.doc2 });
      const third = await visit(A, { patient: first.patientId, doctor: A.doc1 });
      const list = await http()
        .get(`/patients/${first.patientId}/visits`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(3);
      expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([
        third.res.body.id,
        second.res.body.id,
        first.res.body.id,
      ]);
      expect(list.body.items[0].bill).toMatchObject({ paymentStatus: 'PAID' });
      expect(list.body.items[0].bill).not.toHaveProperty('lines');
      const paged = await http()
        .get(`/patients/${first.patientId}/visits?page=2&pageSize=2`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(paged.body.items.map((v: { id: string }) => v.id)).toEqual([first.res.body.id]);
      const capped = await http()
        .get(`/patients/${first.patientId}/visits?pageSize=100000`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(capped.body.pageSize).toBe(100);
      // Other branch: none. Doctor: only own. Nurse: all, without money. Foreign hospital: 404.
      const east = await http()
        .get(`/patients/${first.patientId}/visits`)
        .set('Authorization', `Bearer ${A.tokens.recvEast}`);
      expect(east.body.total).toBe(0);
      const doc2 = await http()
        .get(`/patients/${first.patientId}/visits`)
        .set('Authorization', `Bearer ${A.tokens.doc2}`);
      expect(doc2.body.items.map((v: { id: string }) => v.id)).toEqual([second.res.body.id]);
      expect(doc2.body.items[0]).not.toHaveProperty('bill');
      const nurse = await http()
        .get(`/patients/${first.patientId}/visits`)
        .set('Authorization', `Bearer ${A.tokens.nurse}`);
      expect(nurse.body.total).toBe(3);
      expect(
        (
          await http()
            .get(`/patients/${first.patientId}/visits`)
            .set('Authorization', `Bearer ${B.tokens.recv}`)
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .get(`/patients/${first.patientId}/visits`)
            .set('Authorization', `Bearer ${A.tokens.nobody}`)
        ).status,
      ).toBe(403);
    });
  });

  // ------------------------------------------------ price preview and expected total

  describe('POST /opd/visits/preview and expectedTotalPaise', () => {
    async function addDoctor(h: Hospital, code: string, amount: number): Promise<string> {
      const u = await owner.user.create({
        data: {
          tenantId: h.tenant,
          code: `X${code}${stamp}`.slice(0, 40),
          email: `ov_x_${code}_${stamp}@example.test`,
          displayName: `Doc ${code}`,
          passwordHash: 'x',
        },
      });
      await owner.userBranch.create({
        data: { tenantId: h.tenant, userId: u.id, branchId: h.main },
      });
      const profile = await owner.doctorProfile.create({
        data: { tenantId: h.tenant, userId: u.id, code: `DOC_X_${code}_${stamp}` },
      });
      for (const type of ['NEW', 'FOLLOW_UP'] as const) {
        await owner.doctorFee.create({
          data: {
            tenantId: h.tenant,
            doctorProfileId: profile.id,
            visitType: type,
            amountPaise: amount,
            effectiveFrom: new Date('2020-01-01'),
            createdBy: h.user,
          },
        });
      }
      return profile.id;
    }

    it('shows exactly what the real create charges (lines and total) and writes nothing', async () => {
      const patientId = await newPatient(A);
      const before = await counts(A);
      const res = await preview(A, 'recv', {
        patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        visitType: 'NEW',
        totalPaise: NEW_FEE + REG_FEE,
        followUpFree: false,
        registrationIncluded: true,
        sameDayVisitWithDoctor: false,
        doctor: { id: A.doc1 },
      });
      expect(
        res.body.lines.map((l: { kind: string; lineTotalPaise: number }) => [
          l.kind,
          l.lineTotalPaise,
        ]),
      ).toEqual([
        ['CONSULTATION', NEW_FEE],
        ['REGISTRATION', REG_FEE],
      ]);
      expect(await counts(A)).toEqual(before);

      // The real create with the previewed total charges exactly that.
      const created = await create(A, 'recv', {
        patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-PREV'),
        expectedTotalPaise: res.body.totalPaise,
      });
      expect(created.status).toBe(201);
      expect(created.body.bill.totalPaise).toBe(res.body.totalPaise);
      expect(
        created.body.bill.lines.map((l: { lineTotalPaise: number }) => l.lineTotalPaise),
      ).toEqual(res.body.lines.map((l: { lineTotalPaise: number }) => l.lineTotalPaise));

      // After the first visit the registration fee is gone from the preview.
      const again = await preview(A, 'recv', {
        patientId,
        doctorProfileId: A.doc2,
        visitType: 'NEW',
      });
      expect(again.body).toMatchObject({ totalPaise: DOC2_NEW_FEE, registrationIncluded: false });
    });

    it('takes no bill, receipt or token number (previews leave no gap)', async () => {
      const first = await visit(A);
      const lastBill = suffix(first.res.body.bill.billNumber);
      const lastReceipt = suffix(first.res.body.bill.payments[0].receiptNumber);
      const lastToken = first.res.body.token.no as number;
      for (let i = 0; i < 3; i += 1) {
        const r = await preview(A, 'recv', {
          patientId: await newPatient(A),
          doctorProfileId: A.doc1,
          visitType: 'NEW',
        });
        expect(r.status).toBe(200);
      }
      const next = await visit(A);
      expect(suffix(next.res.body.bill.billNumber)).toBe(lastBill + 1);
      expect(suffix(next.res.body.bill.payments[0].receiptNumber)).toBe(lastReceipt + 1);
      expect(next.res.body.token.no).toBe(lastToken + 1);
    });

    it('refuses what the real create refuses (same codes), and needs the same permission', async () => {
      const patientId = await newPatient(A);
      const body = { patientId, doctorProfileId: A.doc1, visitType: 'NEW' };
      expect(
        (await preview(A, 'recv', { ...body, doctorProfileId: A.doc3Off })).body,
      ).toMatchObject({ code: 'DOCTOR_UNAVAILABLE', reason: 'SWITCH_OFF' });
      expect(
        (await preview(A, 'recv', { ...body, doctorProfileId: A.doc4EastOnly })).body.code,
      ).toBe('DOCTOR_NOT_IN_BRANCH');
      expect((await preview(A, 'recv', { ...body, doctorProfileId: A.doc5NoFee })).body.code).toBe(
        'FEE_NOT_CONFIGURED',
      );
      expect((await preview(A, 'recv', { ...body, visitType: 'FOLLOW_UP' })).body.code).toBe(
        'FOLLOW_UP_NEEDS_PREVIOUS_VISIT',
      );
      expect((await preview(A, 'recv', { ...body, patientId: await newPatient(B) })).status).toBe(
        404,
      );
      expect((await preview(A, 'recv', { ...body, doctorProfileId: B.doc1 })).status).toBe(404);
      for (const who of ['nurse', 'nobody', 'doc1']) {
        expect((await preview(A, who, body)).status).toBe(403);
      }
      expect((await http().post('/opd/visits/preview').send(body)).status).toBe(401);
      for (const extra of [
        { totalPaise: 1 },
        { branchId: A.east },
        { idempotencyKey: 'KEY-12345678' },
      ]) {
        expect((await preview(A, 'recv', { ...body, ...extra })).status).toBe(400);
      }
      await owner.opdSettings.update({ where: { tenantId: A.tenant }, data: { taxEnabled: true } });
      try {
        expect((await preview(A, 'recv', body)).status).toBe(501);
      } finally {
        await owner.opdSettings.update({
          where: { tenantId: A.tenant },
          data: { taxEnabled: false },
        });
      }
    });

    it('a free follow-up previews as zero and says so', async () => {
      const first = await visit(A);
      await complete(first.res.body.id);
      const res = await preview(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'FOLLOW_UP',
      });
      expect(res.body).toMatchObject({
        totalPaise: 0,
        followUpFree: true,
        registrationIncluded: false,
      });
      expect(res.body.lines[0]).toMatchObject({
        unitPricePaise: 0,
        pricingNote: 'FOLLOW_UP_FREE_WINDOW',
      });
    });

    it('warns when the patient already has a visit with this doctor today (not with another doctor)', async () => {
      const first = await visit(A, { doctor: A.doc1 });
      const same = await preview(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
      });
      const other = await preview(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc2,
        visitType: 'NEW',
      });
      expect(same.body.sameDayVisitWithDoctor).toBe(true);
      expect(other.body.sameDayVisitWithDoctor).toBe(false);
      // Tomorrow it is a new day.
      clock.set(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const next = await preview(A, 'recv', {
        patientId: first.patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
      });
      expect(next.body.sameDayVisitWithDoctor).toBe(false);
    });

    it('a changed total is refused (409 PRICE_CHANGED) and nothing is charged or numbered', async () => {
      const doctor = await addDoctor(A, `chg${seq}`, 20_000);
      const patientId = await newPatient(A);
      const shown = await preview(A, 'recv', {
        patientId,
        doctorProfileId: doctor,
        visitType: 'NEW',
      });
      expect(shown.body.totalPaise).toBe(20_000 + REG_FEE);

      // The fee list changes between the preview and the click.
      await owner.doctorFee.create({
        data: {
          tenantId: A.tenant,
          doctorProfileId: doctor,
          visitType: 'NEW',
          amountPaise: 25_000,
          effectiveFrom: new Date(Date.now() - 1000),
          createdBy: A.user,
        },
      });
      const before = await counts(A);
      const refused = await create(A, 'recv', {
        patientId,
        doctorProfileId: doctor,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-CHG'),
        expectedTotalPaise: shown.body.totalPaise,
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'PRICE_CHANGED',
        totalPaise: 25_000 + REG_FEE,
        expectedTotalPaise: 20_000 + REG_FEE,
      });
      expect(await counts(A)).toEqual(before);

      // Looking again and confirming the new total works.
      const again = await create(A, 'recv', {
        patientId,
        doctorProfileId: doctor,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-CHG'),
        expectedTotalPaise: 25_000 + REG_FEE,
      });
      expect(again.status).toBe(201);
      expect(again.body.bill.totalPaise).toBe(25_000 + REG_FEE);
    });

    it('expectedTotalPaise must be a whole non-negative number within the integer limit', async () => {
      const base = { patientId: await newPatient(A), doctorProfileId: A.doc1, visitType: 'NEW' };
      for (const bad of [-1, 1.5, '600', 2_147_483_648, null]) {
        const res = await create(A, 'recv', {
          ...base,
          idempotencyKey: uniq('KEY-AAAA'),
          expectedTotalPaise: bad,
        });
        expect(res.status).toBe(400);
      }
      // A wrong total of zero is refused too (not treated as "absent").
      const zero = await create(A, 'recv', {
        ...base,
        idempotencyKey: uniq('KEY-AAAA'),
        expectedTotalPaise: 0,
      });
      expect(zero.status).toBe(409);
    });
  });

  // ------------------------------------------------ hardening (attacks from the self-review)

  describe('hardening', () => {
    it('a hospital without bill/receipt number settings gets a clear 409 and nothing is stored', async () => {
      const row = await owner.numberSeriesSettings.findFirstOrThrow({
        where: { tenantId: B.tenant, series: 'RECEIPT' },
      });
      await owner.numberSeriesSettings.delete({ where: { id: row.id } });
      try {
        const before = await counts(B);
        const { res } = await visit(B);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'NUMBER_SERIES_NOT_CONFIGURED', series: 'RECEIPT' });
        // The bill number taken a moment earlier was rolled back with the rest.
        expect(await counts(B)).toEqual(before);
      } finally {
        await owner.numberSeriesSettings.create({
          data: {
            tenantId: B.tenant,
            series: 'RECEIPT',
            format: FY_FORMAT,
            resetRule: 'FINANCIAL_YEAR',
            fyStartMonth: 4,
          },
        });
      }
      const ok = await visit(B);
      expect(ok.res.status).toBe(201);
    });

    it('a branch where the OPD module is switched off cannot create or read visits (403)', async () => {
      const opd = await owner.module.findUniqueOrThrow({ where: { code: 'OPD' } });
      await owner.branchModule.updateMany({
        where: { tenantId: A.tenant, branchId: A.east, moduleId: opd.id },
        data: { isActive: false },
      });
      try {
        const { res } = await visit(A, { who: 'recvEast', doctor: A.doc4EastOnly });
        expect(res.status).toBe(403);
        expect(
          (await http().get('/opd/doctors').set('Authorization', `Bearer ${A.tokens.recvEast}`))
            .status,
        ).toBe(403);
      } finally {
        await owner.branchModule.updateMany({
          where: { tenantId: A.tenant, branchId: A.east, moduleId: opd.id },
          data: { isActive: true },
        });
      }
    });

    it('oversized or odd inputs are refused or harmless (no 500)', async () => {
      const long = 'x'.repeat(65);
      const base = { patientId: await newPatient(A), doctorProfileId: A.doc1, visitType: 'NEW' };
      for (const bad of [
        { patientId: long },
        { doctorProfileId: long },
        { idempotencyKey: 'k'.repeat(65) },
        { paymentModeCode: 'c'.repeat(33) },
        { referenceNo: 'r'.repeat(65) },
      ]) {
        const res = await create(A, 'recv', { ...base, idempotencyKey: uniq('KEY-AAAA'), ...bad });
        expect(res.status).toBe(400);
      }
      const huge = await http()
        .get(`/patients/${base.patientId}/visits?page=999999999999&pageSize=abc`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(huge.status).toBe(200);
      expect(huge.body).toMatchObject({ items: [], pageSize: 20 });
    });
  });

  // ------------------------------------------------------------ admin roles are read-only

  describe('system admin roles', () => {
    const NEVER_DONE_BY_AN_ADMIN = [
      'opd.visits.create',
      'opd.billing.collect',
      'opd.vitals.write',
      'opd.notes.write',
      // Step 6a: admins never ask for refunds, order tests or bill them
      'opd.refunds.request',
      'opd.investigations.order',
      'opd.investigations.bill',
      // Step 7c: an admin has no doctor profile of their own (they correct others with opd.doctors.write)
      'opd.doctors.own',
      // Step 2.1b: templates and logos belong to the Indigo Owner, the all-patients view to doctors
      'print.templates.manage',
      'patients.history.view_all',
    ];
    const FLOOR_READS = ['opd.queue.read', 'opd.vitals.read', 'opd.notes.read'];

    async function codesOf(roleId: string): Promise<string[]> {
      const rows = await owner.rolePermission.findMany({
        where: { roleId, isActive: true },
        include: { permission: true },
      });
      return rows.map((r) => r.permission.code);
    }

    it('both admin roles read visits, bills and registry, decide refunds and read reports, but never create, collect, write or order', async () => {
      const hospital = await owner.hospital.create({
        data: { code: `OV_ADM_${stamp}`, name: 'Admin roles', isTest: true },
      });
      const { superAdminRoleId, branchAdminRoleId } = await ensureSystemRolesForTenant(
        owner,
        hospital.id,
      );
      for (const roleId of [superAdminRoleId, branchAdminRoleId]) {
        const codes = await codesOf(roleId);
        expect(codes).toEqual(
          expect.arrayContaining([
            'opd.visits.read',
            'opd.billing.read',
            'patients.registry.read',
            'opd.masters.read',
            // Step 6a: admins DECIDE refunds
            'opd.refunds.approve',
            'opd.reports.read',
          ]),
        );
        for (const forbidden of NEVER_DONE_BY_AN_ADMIN) {
          expect({ roleId, forbidden, has: codes.includes(forbidden) }).toEqual({
            roleId,
            forbidden,
            has: false,
          });
        }
      }
      // An earlier grant is switched off when the seed runs again (idempotent clean-up).
      for (const roleId of [superAdminRoleId, branchAdminRoleId]) {
        const create = await owner.permission.findUniqueOrThrow({
          where: { code: 'opd.visits.create' },
        });
        await owner.rolePermission.upsert({
          where: {
            tenantId_roleId_permissionId: {
              tenantId: hospital.id,
              roleId,
              permissionId: create.id,
            },
          },
          create: { tenantId: hospital.id, roleId, permissionId: create.id },
          update: { isActive: true },
        });
      }
      await ensureSystemRolesForTenant(owner, hospital.id);
      for (const roleId of [superAdminRoleId, branchAdminRoleId]) {
        const create = await owner.permission.findUniqueOrThrow({
          where: { code: 'opd.visits.create' },
        });
        const after = await owner.rolePermission.findFirstOrThrow({
          where: { roleId, permissionId: create.id },
        });
        expect(after.isActive).toBe(false);
      }
    });

    it('the SuperAdmin, the main controller, also READS the OPD floor: queue (all statuses), vitals and notes', async () => {
      const hospital = await owner.hospital.create({
        data: { code: `OV_SA_${stamp}`, name: 'Super admin reads', isTest: true },
      });
      const { superAdminRoleId, branchAdminRoleId } = await ensureSystemRolesForTenant(
        owner,
        hospital.id,
      );
      const superCodes = await codesOf(superAdminRoleId);
      for (const code of FLOOR_READS) {
        expect(superCodes).toContain(code);
      }
      // the Branch Admin does not: only the hospital-wide controller does
      const branchCodes = await codesOf(branchAdminRoleId);
      for (const code of FLOOR_READS) {
        expect(branchCodes).not.toContain(code);
      }
    });

    it('a SuperAdmin made by the older seed (without the reads) gets them on the next seed run', async () => {
      const hospital = await owner.hospital.create({
        data: { code: `OV_SU_${stamp}`, name: 'Super admin upgrade', isTest: true },
      });
      const { superAdminRoleId } = await ensureSystemRolesForTenant(owner, hospital.id);
      const queue = await owner.permission.findUniqueOrThrow({ where: { code: 'opd.queue.read' } });
      await owner.rolePermission.updateMany({
        where: { roleId: superAdminRoleId, permissionId: queue.id },
        data: { isActive: false },
      });
      expect(await codesOf(superAdminRoleId)).not.toContain('opd.queue.read');
      await ensureSystemRolesForTenant(owner, hospital.id);
      expect(await codesOf(superAdminRoleId)).toContain('opd.queue.read');
    });

    it('every permission of the catalog is either given to the SuperAdmin or on its short list of person-only actions', async () => {
      const hospital = await owner.hospital.create({
        data: { code: `OV_SC_${stamp}`, name: 'Super admin catalog', isTest: true },
      });
      const { superAdminRoleId } = await ensureSystemRolesForTenant(owner, hospital.id);
      const { SUPER_ADMIN_EXCLUDED_PERMISSION_CODES } =
        await import('../../../prisma/seeds/reference');
      const catalog = (await owner.permission.findMany({ where: { isActive: true } })).map(
        (p) => p.code,
      );
      const have = new Set(await codesOf(superAdminRoleId));
      const missing = catalog.filter(
        (code) => !have.has(code) && !SUPER_ADMIN_EXCLUDED_PERMISSION_CODES.includes(code),
      );
      expect(missing).toEqual([]);
      expect([...SUPER_ADMIN_EXCLUDED_PERMISSION_CODES].sort()).toEqual(
        [...NEVER_DONE_BY_AN_ADMIN].sort(),
      );
    });
  });
  // ------------------------------------------------------------------ Step 2.1a: reception symptoms

  describe('symptoms typed by reception (Step 2.1a)', () => {
    const put = (who: string, visitId: string, receptionSymptoms: unknown) =>
      http()
        .put(`/opd/visits/${visitId}/reception-symptoms`)
        .set('Authorization', `Bearer ${A.tokens[who]}`)
        .send({ receptionSymptoms });

    it('symptoms given while billing are stored and shown with the receptionist name; the audit never holds the words', async () => {
      const patientId = await newPatient(A);
      const res = await create(A, 'recv', {
        patientId,
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-SYMP'),
        receptionSymptoms: '  Cold cough with fever since yesterday ',
      });
      expect(res.status).toBe(201);
      expect(res.body.receptionSymptoms).toBe('Cold cough with fever since yesterday');
      expect(typeof res.body.createdByName).toBe('string');
      expect(res.body.createdByName.length).toBeGreaterThan(0);
      const read = await http()
        .get(`/opd/visits/${res.body.id}`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(read.body.receptionSymptoms).toBe('Cold cough with fever since yesterday');
      const audits = await owner.auditLog.findMany({ where: { tenantId: A.tenant } });
      expect(JSON.stringify(audits)).not.toContain('Cold cough');
    });

    it('is optional, and an empty text means none', async () => {
      const { res } = await visit(A);
      expect(res.body.receptionSymptoms).toBeNull();
      const blank = await create(A, 'recv', {
        patientId: await newPatient(A),
        doctorProfileId: A.doc1,
        visitType: 'NEW',
        idempotencyKey: uniq('KEY-BLANK'),
        receptionSymptoms: '   ',
      });
      expect(blank.body.receptionSymptoms).toBeNull();
    });

    it('reception can change and clear it until the doctor starts; the audit says only that it changed', async () => {
      const { res } = await visit(A);
      const id = res.body.id as string;
      const set = await put('recv', id, 'Headache');
      expect(set.status).toBe(200);
      expect(set.body.receptionSymptoms).toBe('Headache');
      const cleared = await put('recv', id, '');
      expect(cleared.status).toBe(200);
      expect(cleared.body.receptionSymptoms).toBeNull();
      const log = await owner.auditLog.findMany({
        where: { tenantId: A.tenant, action: 'OPD_VISIT_SYMPTOMS_CHANGE', entityId: id },
      });
      expect(log).toHaveLength(2);
      expect(JSON.stringify(log.map((l) => l.metadata))).not.toContain('Headache');
    });

    it('once the doctor has started it is read-only (409), and the database refuses it too', async () => {
      const { res } = await visit(A);
      const id = res.body.id as string;
      await put('recv', id, 'Fever');
      await asOwner((c) =>
        c.query(
          `UPDATE opd_visits SET status='IN_CONSULTATION', consultation_started_at=now(), updated_at=now() WHERE id=$1`,
          [id],
        ),
      );
      const late = await put('recv', id, 'Something else');
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('CONSULTATION_STARTED');
      await expect(
        asOwner((c) => c.query(`UPDATE opd_visits SET reception_symptoms='x' WHERE id=$1`, [id])),
      ).rejects.toThrow(/cannot change once the doctor has started/);
      const back = await http()
        .get(`/opd/visits/${id}`)
        .set('Authorization', `Bearer ${A.tokens.recv}`);
      expect(back.body.receptionSymptoms).toBe('Fever');
    });

    it('limits and permissions: 500 characters, a visit of another branch is 404, no permission is 403', async () => {
      const { res } = await visit(A);
      const id = res.body.id as string;
      expect((await put('recv', id, 'x'.repeat(501))).status).toBe(400);
      expect((await put('recv', id, 5)).status).toBe(400);
      expect((await put('recvEast', id, 'Fever')).status).toBe(404);
      expect((await put('nurse', id, 'Fever')).status).toBe(403);
      expect((await put('nobody', id, 'Fever')).status).toBe(403);
      const other = await http()
        .put(`/opd/visits/${id}/reception-symptoms`)
        .set('Authorization', `Bearer ${B.tokens.recv}`)
        .send({ receptionSymptoms: 'Fever' });
      expect(other.status).toBe(404);
    });
  });
});
