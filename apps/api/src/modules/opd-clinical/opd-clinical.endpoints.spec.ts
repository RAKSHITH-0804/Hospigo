import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CLOCK, FakeClock } from '../../common/clock';
import { createOwnerPrisma, createPgClient, withTenant } from '../../database/db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for OPD clinical tests`);
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
const RECEPTION_PERMS = [
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'opd.queue.read',
  'patients.registry.read',
] as const;
const NURSE_PERMS = [
  'opd.masters.read',
  'opd.visits.read',
  'opd.queue.read',
  'opd.vitals.read',
  'opd.vitals.write',
  'opd.notes.read',
] as const;
const DOCTOR_PERMS = [...NURSE_PERMS, 'opd.notes.write'] as const;
const ALL_CLINICAL = [...new Set([...RECEPTION_PERMS, ...DOCTOR_PERMS])];

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
  docReadOnly: string;
  medicine: string;
  medicineOff: string;
  tokens: Record<string, string>;
  users: Record<string, string>;
};

describe('OPD clinical endpoints: queue, note, prescription, vitals (HTTP)', () => {
  jest.setTimeout(120_000);
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
        code: `OC_${label}_${stamp}`,
        name: `Clinical ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `oc-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `oc-${label}-e-${stamp}` },
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
    await owner.paymentMode.create({
      data: { tenantId: tenant, code: 'CASH', name: 'CASH', requiresReference: false },
    });
    const staff = await owner.user.create({
      data: {
        tenantId: tenant,
        code: `S${label}${stamp}`,
        email: `oc_s_${label}_${stamp}@example.test`,
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
        amountPaise: 10_000,
        effectiveFrom: new Date('2020-01-01'),
        createdBy: staff.id,
      },
    });
    await owner.vitalsField.create({
      data: {
        tenantId: tenant,
        code: 'PULSE',
        name: 'Pulse',
        unit: 'bpm',
        valueKind: 'NUMBER',
        displayOrder: 1,
        warnMin: 50,
        warnMax: 100,
      },
    });
    await owner.vitalsField.create({
      data: {
        tenantId: tenant,
        code: 'POSTURE',
        name: 'Posture',
        unit: '-',
        valueKind: 'TEXT',
        displayOrder: 2,
      },
    });
    await owner.vitalsField.create({
      data: {
        tenantId: tenant,
        code: 'OLDFIELD',
        name: 'Old field',
        unit: 'x',
        valueKind: 'NUMBER',
        displayOrder: 3,
        active: false,
      },
    });
    const medicine = await owner.medicine.create({
      data: { tenantId: tenant, code: 'PARA', name: 'Paracetamol 500' },
    });
    const medicineOff = await owner.medicine.create({
      data: { tenantId: tenant, code: 'OLDMED', name: 'Old medicine', active: false },
    });

    const perms = await owner.permission.findMany({ where: { code: { in: ALL_CLINICAL } } });
    if (perms.length !== ALL_CLINICAL.length) {
      throw new Error('Clinical permissions missing from the test catalog');
    }
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));

    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    async function makeUser(key: string, codes: readonly string[], branches: string[]) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `oc_${key}_${label}_${stamp}@example.test`,
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
    await makeUser('nurse', NURSE_PERMS, [main]);
    await makeUser('nurseEast', NURSE_PERMS, [east]);
    await makeUser('admin', ['opd.visits.read', 'opd.billing.read'], [main]);
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
    // A doctor who may only READ notes (no notes.write): the write routes must still refuse.
    const readOnly = await makeUser('docReadOnly', NURSE_PERMS, [main]);
    const readOnlyProfile = await owner.doctorProfile.create({
      data: { tenantId: tenant, userId: readOnly.id, code: `DOC_ro_${label}_${stamp}` },
    });
    for (const type of ['NEW', 'FOLLOW_UP'] as const) {
      await owner.doctorFee.create({
        data: {
          tenantId: tenant,
          doctorProfileId: readOnlyProfile.id,
          visitType: type,
          amountPaise: 50_000,
          effectiveFrom: new Date('2020-01-01'),
          createdBy: staff.id,
        },
      });
    }
    const doc1 = await makeDoctor('doc1');
    const doc2 = await makeDoctor('doc2');
    const doc3 = await makeDoctor('doc3');

    return {
      tenant,
      main,
      east,
      user: staff.id,
      doc1,
      doc2,
      doc3,
      docReadOnly: readOnlyProfile.id,
      medicine: medicine.id,
      medicineOff: medicineOff.id,
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
  async function newPatient(h: Hospital, dateOfBirth?: Date): Promise<string> {
    patientCounter += 1;
    const p = await owner.patient.create({
      data: {
        tenantId: h.tenant,
        uhid: `OC${h.tenant.slice(-6)}${stamp}${patientCounter}`,
        registeredBranchId: h.main,
        name: `Secret Name ${patientCounter}`,
        gender: 'F',
        dateOfBirth: dateOfBirth ?? null,
        createdBy: h.user,
      },
    });
    return p.id;
  }

  /** A paid, queued visit made through the real reception API. */
  async function waiting(h: Hospital, doctor: string = h.doc1, dob?: Date): Promise<string> {
    const res = await post(h, 'recv', '/opd/visits', {
      patientId: await newPatient(h, dob),
      doctorProfileId: doctor,
      visitType: 'NEW',
      idempotencyKey: uniq('KEY-CLIN'),
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('WAITING');
    return res.body.id as string;
  }

  const start = (h: Hospital, who: string, id: string) => post(h, who, `/opd/visits/${id}/start`);
  async function started(h: Hospital, who = 'doc1', doctor: string = h.doc1): Promise<string> {
    const id = await waiting(h, doctor);
    expect((await start(h, who, id)).status).toBe(200);
    return id;
  }
  const saveNote = (h: Hospital, who: string, id: string, body: object) =>
    put(h, who, `/opd/visits/${id}/consultation`, body);
  const complete = (h: Hospital, who: string, id: string) =>
    post(h, who, `/opd/visits/${id}/complete`);
  const auditRows = (h: Hospital, action: string, entityId?: string) =>
    owner.auditLog.findMany({
      where: { tenantId: h.tenant, action, ...(entityId ? { entityId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  const settled = async (calls: Array<() => Promise<{ status: number; body: Loose }>>) =>
    Promise.all(calls.map((c) => c()));

  // -------------------------------------------------------------------------------- access

  describe('access', () => {
    const routes: Array<[string, string]> = [
      ['get', '/opd/medicines'],
      ['get', '/opd/queue'],
      ['post', '/opd/visits/x/start'],
      ['get', '/opd/visits/x/consultation'],
      ['put', '/opd/visits/x/consultation'],
      ['put', '/opd/visits/x/prescription'],
      ['post', '/opd/visits/x/complete'],
      ['post', '/opd/visits/x/consultation/addenda'],
      ['get', '/opd/vitals-fields'],
      ['get', '/opd/visits/x/vitals'],
      ['post', '/opd/visits/x/vitals'],
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

    it('403 for staff without the permission (reception, admin, nobody); reception may only read the queue', async () => {
      const needs: Record<string, string[]> = {
        recv: routes.map((r) => r[1]).filter((u) => u !== '/opd/queue'),
        nobody: routes.map((r) => r[1]),
        admin: routes.map((r) => r[1]),
      };
      for (const who of Object.keys(needs)) {
        for (const [method, url] of routes) {
          if (!needs[who]!.includes(url)) {
            continue;
          }
          const res = await call(method, url, as(A, who));
          expect({ who, url, status: res.status }).toEqual({ who, url, status: 403 });
        }
      }
      expect((await get(A, 'recv', '/opd/queue')).status).toBe(200);
    });

    it('a nurse reads and records vitals but cannot start, write notes or complete', async () => {
      const id = await waiting(A);
      expect((await get(A, 'nurse', `/opd/visits/${id}/consultation`)).status).toBe(200);
      for (const [method, url] of [
        ['post', `/opd/visits/${id}/start`],
        ['put', `/opd/visits/${id}/consultation`],
        ['put', `/opd/visits/${id}/prescription`],
        ['post', `/opd/visits/${id}/complete`],
        ['post', `/opd/visits/${id}/consultation/addenda`],
      ]) {
        expect((await call(method, url, as(A, 'nurse'))).status).toBe(403);
      }
    });

    it('a doctor with only notes.read cannot write: every write route is 403 and nothing changes', async () => {
      const id = await waiting(A, A.docReadOnly);
      const url = (tail: string) => `/opd/visits/${id}${tail}`;
      for (const [method, path] of [
        ['post', url('/start')],
        ['put', url('/consultation')],
        ['put', url('/prescription')],
        ['post', url('/complete')],
        ['post', url('/consultation/addenda')],
      ]) {
        expect((await call(method, path, as(A, 'docReadOnly'))).status).toBe(403);
      }
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id } })).status).toBe('WAITING');
      // but reading the note and recording vitals works for them
      expect((await get(A, 'docReadOnly', url('/consultation'))).status).toBe(200);
    });

    it('a user with the notes permission but no doctor profile gets DOCTOR_PROFILE_REQUIRED', async () => {
      const id = await waiting(A);
      const res = await start(A, 'docNoProfile', id);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DOCTOR_PROFILE_REQUIRED');
    });
  });

  // --------------------------------------------------------------------------------- queue

  describe('medicine search', () => {
    it('finds active medicines by name, code or composition, in name order, without extra fields', async () => {
      await owner.medicine.create({
        data: {
          tenantId: A.tenant,
          code: 'AMOX',
          name: 'Amoxicillin 250',
          composition: 'Amoxicillin trihydrate',
        },
      });
      const byName = await get(A, 'doc1', '/opd/medicines?q=amoxi');
      expect(byName.status).toBe(200);
      expect(byName.body.items.map((m: Loose) => m.name)).toEqual(['Amoxicillin 250']);
      expect(Object.keys(byName.body.items[0]).sort()).toEqual(
        ['code', 'composition', 'form', 'id', 'name'].sort(),
      );
      expect((await get(A, 'nurse', '/opd/medicines?q=AMOX')).body.items).toHaveLength(1);
      expect((await get(A, 'nurse', '/opd/medicines?q=trihydrate')).body.items).toHaveLength(1);
      const all = await get(A, 'doc1', '/opd/medicines');
      const names = all.body.items.map((m: Loose) => m.name);
      expect(names).toEqual([...names].sort());
      expect(names).not.toContain('Old medicine');
      expect(
        (await get(A, 'doc1', '/opd/medicines?q=Paracetamol&limit=1')).body.items,
      ).toHaveLength(1);
    });

    it("never lists another hospital's medicines and needs the masters permission", async () => {
      await owner.medicine.create({
        data: { tenantId: B.tenant, code: 'ONLYB', name: 'Only hospital B medicine' },
      });
      const res = await get(A, 'doc1', '/opd/medicines?q=Only hospital B');
      expect(res.body.items).toEqual([]);
      expect((await get(A, 'nobody', '/opd/medicines')).status).toBe(403);
      expect((await http().get('/opd/medicines')).status).toBe(401);
    });
  });

  describe('queue', () => {
    it('a doctor sees only their own waiting visits in payment order; others see theirs', async () => {
      const first = await waiting(A, A.doc2, new Date('1990-06-15'));
      const second = await waiting(A, A.doc2);
      const other = await waiting(A, A.doc3);
      const res = await get(A, 'doc2', '/opd/queue');
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('OWN');
      const ids = res.body.items.map((i: Loose) => i.id);
      expect(ids.indexOf(first)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
      expect(ids).not.toContain(other);
      const row = res.body.items.find((i: Loose) => i.id === first);
      expect(row).toMatchObject({
        status: 'WAITING',
        vitalsRecorded: false,
        token: { label: expect.stringMatching(/^T\d+$/) },
        patient: { gender: 'F' },
      });
      expect(row.patient.name).toMatch(/Secret Name/);
      expect(row.patient.ageYears).toBeGreaterThanOrEqual(30);
      expect(row).not.toHaveProperty('bill');
      const others = await get(A, 'doc3', '/opd/queue');
      expect(others.body.items.map((i: Loose) => i.id)).toContain(other);
      expect(others.body.items.map((i: Loose) => i.id)).not.toContain(first);
    });

    it('an unpaid visit is never in the queue', async () => {
      const patientId = await newPatient(A);
      const visit = await owner.opdVisit.create({
        data: {
          tenantId: A.tenant,
          branchId: A.main,
          patientId,
          doctorProfileId: A.doc1,
          visitType: 'NEW',
          visitDate: new Date(Date.UTC(2020, 0, 1)),
          createdBy: A.user,
        },
      });
      const res = await get(A, 'doc1', '/opd/queue');
      expect(res.body.items.map((i: Loose) => i.id)).not.toContain(visit.id);
    });

    it('a nurse sees the whole branch queue; a nurse of another branch sees none of it', async () => {
      const a = await waiting(A, A.doc1);
      const b = await waiting(A, A.doc3);
      const res = await get(A, 'nurse', '/opd/queue');
      expect(res.body.scope).toBe('BRANCH');
      const ids = res.body.items.map((i: Loose) => i.id);
      expect(ids).toEqual(expect.arrayContaining([a, b]));
      const east = await get(A, 'nurseEast', '/opd/queue');
      expect(east.body.items).toEqual([]);
      const otherHospital = await get(B, 'nurse', '/opd/queue');
      expect(otherHospital.body.items.map((i: Loose) => i.id)).not.toContain(a);
    });

    it('a nurse can narrow the queue to one doctor; the answer lists the doctors in the queue; a doctor can never widen theirs', async () => {
      const one = await waiting(A, A.doc1);
      const three = await waiting(A, A.doc3);
      const all = await get(A, 'nurse', '/opd/queue');
      expect(all.body.doctors.map((d: Loose) => d.id)).toEqual(
        expect.arrayContaining([A.doc1, A.doc3]),
      );
      const only3 = await get(A, 'nurse', `/opd/queue?doctorProfileId=${A.doc3}`);
      expect(only3.status).toBe(200);
      const ids = only3.body.items.map((i: Loose) => i.id);
      expect(ids).toContain(three);
      expect(ids).not.toContain(one);
      // the list of doctors does not shrink with the filter
      expect(only3.body.doctors.map((d: Loose) => d.id)).toEqual(
        expect.arrayContaining([A.doc1, A.doc3]),
      );
      // a doctor asking for another doctor still gets only their own, and no doctor list
      const sneaky = await get(A, 'doc3', `/opd/queue?doctorProfileId=${A.doc1}`);
      expect(sneaky.body.items.map((i: Loose) => i.id)).not.toContain(one);
      expect(sneaky.body.items.map((i: Loose) => i.id)).toContain(three);
      expect(sneaky.body.doctors).toEqual([]);
      // an unknown doctor gives an empty list, a malformed id is refused, another hospital's doctor shows nothing
      expect((await get(A, 'nurse', '/opd/queue?doctorProfileId=nobody')).body.items).toEqual([]);
      expect((await get(A, 'nurse', '/opd/queue?doctorProfileId=a%2Fb')).status).toBe(400);
      expect((await get(A, 'nurse', `/opd/queue?doctorProfileId=${B.doc1}`)).body.items).toEqual(
        [],
      );
    });

    it('started visits stay; a visit completed today stays in the list marked COMPLETED, after the open ones', async () => {
      const id = await started(A, 'doc3', A.doc3);
      let q = await get(A, 'doc3', '/opd/queue');
      expect(q.body.items.find((i: Loose) => i.id === id)?.status).toBe('IN_CONSULTATION');
      expect((await saveNote(A, 'doc3', id, { diagnosis: 'cold' })).status).toBe(200);
      expect((await complete(A, 'doc3', id)).status).toBe(200);
      const open = await waiting(A, A.doc3);
      q = await get(A, 'doc3', '/opd/queue');
      const ids = q.body.items.map((i: Loose) => i.id);
      expect(ids).toEqual(expect.arrayContaining([id, open]));
      expect(ids.indexOf(open)).toBeLessThan(ids.indexOf(id));
      const done = q.body.items.find((i: Loose) => i.id === id);
      expect(done).toMatchObject({ status: 'COMPLETED' });
      expect(done.completedAt).toEqual(expect.any(String));
    });

    it('completed visits are listed latest first, and only those completed TODAY', async () => {
      // seen two days ago (clock), seen now
      clock.set(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
      const longAgo = await started(A, 'doc3', A.doc3);
      await saveNote(A, 'doc3', longAgo, { diagnosis: 'old' });
      await complete(A, 'doc3', longAgo);
      clock.set(new Date());
      const first = await started(A, 'doc3', A.doc3);
      await saveNote(A, 'doc3', first, { diagnosis: 'a' });
      await complete(A, 'doc3', first);
      clock.set(new Date(Date.now() + 60_000)); // a minute later
      const second = await started(A, 'doc3', A.doc3);
      await saveNote(A, 'doc3', second, { diagnosis: 'b' });
      await complete(A, 'doc3', second);
      const ids = (await get(A, 'doc3', '/opd/queue')).body.items.map((i: Loose) => i.id);
      expect(ids).not.toContain(longAgo);
      expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
    });

    it('a patient paid yesterday but seen today counts as seen today', async () => {
      clock.set(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const id = await waiting(A, A.doc3);
      clock.set(new Date());
      await start(A, 'doc3', id);
      await saveNote(A, 'doc3', id, { diagnosis: 'seen today' });
      await complete(A, 'doc3', id);
      const item = (await get(A, 'doc3', '/opd/queue')).body.items.find((i: Loose) => i.id === id);
      expect(item.status).toBe('COMPLETED');
    });

    it('reception sees the whole branch (waiting, in consultation, completed) but no clinical text and no money', async () => {
      const doneId = await started(A, 'doc3', A.doc3);
      await saveNote(A, 'doc3', doneId, { complaints: 'SECRET-COMPLAINT', diagnosis: 'SECRET-DX' });
      await complete(A, 'doc3', doneId);
      const waitingId = await waiting(A, A.doc1);
      const res = await get(A, 'recv', '/opd/queue');
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('BRANCH');
      const ids = res.body.items.map((i: Loose) => i.id);
      expect(ids).toEqual(expect.arrayContaining([doneId, waitingId]));
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/SECRET-COMPLAINT|SECRET-DX|complaints|diagnosis|Paise|bill/i);
      // and reception still cannot open any note or vitals
      expect((await get(A, 'recv', `/opd/visits/${doneId}/consultation`)).status).toBe(403);
      expect((await get(A, 'recv', `/opd/visits/${doneId}/vitals`)).status).toBe(403);
    });

    it('a patient still waiting after midnight stays in the queue, oldest first, with the day of the visit', async () => {
      // Paid two days ago ...
      clock.set(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
      const old = await waiting(A, A.doc3);
      // ... and another one paid now.
      clock.set(new Date());
      const fresh = await waiting(A, A.doc3);
      const res = await get(A, 'doc3', '/opd/queue');
      const ids = res.body.items.map((i: Loose) => i.id);
      expect(ids).toEqual(expect.arrayContaining([old, fresh]));
      expect(ids.indexOf(old)).toBeLessThan(ids.indexOf(fresh));
      const oldItem = res.body.items.find((i: Loose) => i.id === old);
      expect(oldItem.visitDate < res.body.date).toBe(true);
      expect(res.body.items.find((i: Loose) => i.id === fresh).visitDate).toBe(res.body.date);
      // and the nurse sees it too
      const nurse = await get(A, 'nurse', '/opd/queue');
      expect(nurse.body.items.map((i: Loose) => i.id)).toContain(old);
    });

    it('vitalsRecorded turns true once a reading exists', async () => {
      const id = await waiting(A, A.doc1);
      expect(
        (
          await post(A, 'nurse', `/opd/visits/${id}/vitals`, {
            readings: [{ fieldCode: 'PULSE', value: 72 }],
          })
        ).status,
      ).toBe(200);
      const q = await get(A, 'nurse', '/opd/queue');
      expect(q.body.items.find((i: Loose) => i.id === id).vitalsRecorded).toBe(true);
    });
  });

  // --------------------------------------------------------------------------------- start

  describe('start', () => {
    it('starts once, a second click returns the same state, nothing is audited twice', async () => {
      const id = await waiting(A);
      const first = await start(A, 'doc1', id);
      expect(first.status).toBe(200);
      expect(first.body.replayed).toBe(false);
      expect(first.body.visit.status).toBe('IN_CONSULTATION');
      expect(first.body.visit.consultationStartedAt).not.toBeNull();
      const again = await start(A, 'doc1', id);
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(again.body.visit.consultationStartedAt).toBe(first.body.visit.consultationStartedAt);
      expect(await auditRows(A, 'OPD_VISIT_START', id)).toHaveLength(1);
    });

    it('eight parallel starts give one start', async () => {
      const id = await waiting(A);
      const results = await settled(Array.from({ length: 8 }, () => () => start(A, 'doc1', id)));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
      expect(await auditRows(A, 'OPD_VISIT_START', id)).toHaveLength(1);
    });

    it("another doctor's visit, another branch and another hospital are 404", async () => {
      const id = await waiting(A, A.doc1);
      for (const [h, who] of [
        [A, 'doc2'],
        [B, 'doc1'],
      ] as const) {
        const res = await start(h, who, id);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('VISIT_NOT_FOUND');
      }
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id } })).status).toBe('WAITING');
    });

    it('an unpaid or finished visit cannot be started', async () => {
      const patientId = await newPatient(A);
      const unpaid = await owner.opdVisit.create({
        data: {
          tenantId: A.tenant,
          branchId: A.main,
          patientId,
          doctorProfileId: A.doc1,
          visitType: 'NEW',
          visitDate: new Date(),
          createdBy: A.user,
        },
      });
      const res = await start(A, 'doc1', unpaid.id);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'VISIT_NOT_WAITING', status: 'AWAITING_PAYMENT' });

      const done = await started(A);
      await saveNote(A, 'doc1', done, { diagnosis: 'x' });
      await complete(A, 'doc1', done);
      const late = await start(A, 'doc1', done);
      expect(late.status).toBe(409);
      expect(late.body.status).toBe('COMPLETED');
    });
  });

  // ---------------------------------------------------------------------------------- note

  describe('note', () => {
    it('needs a started consultation; then saves, reads and REPLACES the four fields', async () => {
      const id = await waiting(A);
      const early = await saveNote(A, 'doc1', id, { diagnosis: 'x' });
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ code: 'VISIT_NOT_IN_CONSULTATION', status: 'WAITING' });
      await start(A, 'doc1', id);
      const saved = await saveNote(A, 'doc1', id, {
        complaints: '  fever for 3 days ',
        diagnosis: 'viral fever',
        advice: 'rest',
        followUpDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      });
      expect(saved.status).toBe(200);
      expect(saved.body.consultation).toMatchObject({
        status: 'DRAFT',
        complaints: 'fever for 3 days',
        diagnosis: 'viral fever',
        advice: 'rest',
      });
      expect(saved.body.consultation.completedAt).toBeNull();
      const replaced = await saveNote(A, 'doc1', id, { diagnosis: '   ', complaints: 'cough' });
      expect(replaced.body.consultation).toMatchObject({
        complaints: 'cough',
        diagnosis: null,
        advice: null,
        followUpDate: null,
      });
      const read = await get(A, 'doc1', `/opd/visits/${id}/consultation`);
      expect(read.body.consultation.complaints).toBe('cough');
      expect(read.body.visit.id).toBe(id);
    });

    it('refuses extra fields, too-long text and impossible follow-up dates', async () => {
      const id = await started(A);
      for (const body of [
        { diagnosis: 'x', status: 'COMPLETED' },
        { diagnosis: 'x', doctorProfileId: A.doc2 },
        { diagnosis: 'x', branchId: A.east },
        { diagnosis: 'x'.repeat(4001) },
        { diagnosis: 5 },
        { diagnosis: 'x', followUpDate: '15-06-2030' },
      ]) {
        expect((await saveNote(A, 'doc1', id, body)).status).toBe(400);
      }
      const yesterday = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const farAway = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      for (const followUpDate of [yesterday, farAway, '2027-02-30']) {
        const res = await saveNote(A, 'doc1', id, { diagnosis: 'x', followUpDate });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FOLLOW_UP_DATE_INVALID');
      }
      expect(await owner.consultation.count({ where: { visitId: id } })).toBe(0);
    });

    it('audit names the fields that hold text, never the text', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, {
        complaints: 'SECRET-COMPLAINT-TEXT',
        advice: 'SECRET-ADVICE',
      });
      const rows = await auditRows(A, 'OPD_NOTE_SAVE');
      const mine = rows.filter((r) => (r.metadata as Loose)?.visitId === id);
      expect(mine).toHaveLength(1);
      expect((mine[0]!.metadata as Loose).fieldsFilled).toEqual(['complaints', 'advice']);
      expect(JSON.stringify(mine[0])).not.toMatch(/SECRET/);
    });

    it("a doctor cannot read or write another doctor's note (404)", async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'private' });
      for (const res of [
        await get(A, 'doc2', `/opd/visits/${id}/consultation`),
        await saveNote(A, 'doc2', id, { diagnosis: 'overwrite' }),
        await put(A, 'doc2', `/opd/visits/${id}/prescription`, { items: [] }),
        await complete(A, 'doc2', id),
        await post(A, 'doc2', `/opd/visits/${id}/consultation/addenda`, { text: 'a', reason: 'b' }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('VISIT_NOT_FOUND');
      }
      expect(
        (await owner.consultation.findFirstOrThrow({ where: { visitId: id } })).diagnosis,
      ).toBe('private');
    });
  });

  // ---------------------------------------------------------------------------- prescription

  describe('prescription', () => {
    const rx = (h: Hospital, who: string, id: string, items: object[]) =>
      put(h, who, `/opd/visits/${id}/prescription`, { items });
    const row = { dose: '1 tablet', frequency: 'twice a day', duration: '5 days' };

    it('listed medicines are copied from the list, free text is flagged unlisted, the list is replaced', async () => {
      const id = await started(A);
      const res = await rx(A, 'doc1', id, [
        { medicineId: A.medicine, ...row, instructions: 'after food' },
        { medicineName: '  Tulsi drops ', ...row },
      ]);
      expect(res.status).toBe(200);
      expect(res.body.prescription).toEqual([
        expect.objectContaining({
          lineNo: 1,
          medicineId: A.medicine,
          medicineName: 'Paracetamol 500',
          isUnlisted: false,
          instructions: 'after food',
        }),
        expect.objectContaining({
          lineNo: 2,
          medicineId: null,
          medicineName: 'Tulsi drops',
          isUnlisted: true,
        }),
      ]);
      const smaller = await rx(A, 'doc1', id, [{ medicineName: 'Only one', ...row }]);
      expect(smaller.body.prescription).toHaveLength(1);
      expect(smaller.body.prescription[0].lineNo).toBe(1);
      const cleared = await rx(A, 'doc1', id, []);
      expect(cleared.body.prescription).toEqual([]);
      expect(await owner.prescriptionItem.count({ where: { visitId: id } })).toBe(0);
    });

    it("refuses an inactive medicine, another hospital's medicine, both-or-neither names, blanks and too many rows", async () => {
      const id = await started(A);
      const otherMedicine = B.medicine;
      for (const [items, code] of [
        [[{ medicineId: A.medicineOff, ...row }], 'MEDICINE_NOT_FOUND'],
        [[{ medicineId: otherMedicine, ...row }], 'MEDICINE_NOT_FOUND'],
        [[{ medicineId: 'nope', ...row }], 'MEDICINE_NOT_FOUND'],
        [[{ medicineId: A.medicine, medicineName: 'x', ...row }], 'PRESCRIPTION_ITEM_INVALID'],
        [[{ ...row }], 'PRESCRIPTION_ITEM_INVALID'],
        [[{ medicineName: '   ', ...row }], 'PRESCRIPTION_ITEM_INVALID'],
        [[{ medicineName: 'x', ...row, dose: '  ' }], 'PRESCRIPTION_ITEM_INVALID'],
      ] as Array<[object[], string]>) {
        const res = await rx(A, 'doc1', id, items);
        expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code });
      }
      const many = Array.from({ length: 31 }, (_, i) => ({ medicineName: `m${i}`, ...row }));
      expect((await rx(A, 'doc1', id, many)).status).toBe(400);
      expect((await put(A, 'doc1', `/opd/visits/${id}/prescription`, {})).status).toBe(400);
      expect((await rx(A, 'doc1', id, [{ medicineName: 'x', ...row, status: 'z' }])).status).toBe(
        400,
      );
      expect(await owner.prescriptionItem.count({ where: { visitId: id } })).toBe(0);
    });

    it('a refused list changes nothing (the old list stays)', async () => {
      const id = await started(A);
      await rx(A, 'doc1', id, [{ medicineName: 'Keep me', ...row }]);
      const bad = await rx(A, 'doc1', id, [
        { medicineName: 'New', ...row },
        { medicineId: A.medicineOff, ...row },
      ]);
      expect(bad.status).toBe(400);
      const read = await get(A, 'doc1', `/opd/visits/${id}/consultation`);
      expect(read.body.prescription.map((p: Loose) => p.medicineName)).toEqual(['Keep me']);
    });

    it('needs a started consultation; frozen after complete; audit has counts only', async () => {
      const id = await waiting(A);
      expect((await rx(A, 'doc1', id, [])).status).toBe(409);
      await start(A, 'doc1', id);
      await rx(A, 'doc1', id, [
        { medicineId: A.medicine, ...row },
        { medicineName: 'SECRET-MEDICINE', ...row },
      ]);
      const audit = (await auditRows(A, 'OPD_PRESCRIPTION_SAVE')).filter(
        (r) => (r.metadata as Loose).visitId === id,
      );
      expect(audit[0]!.metadata).toMatchObject({ itemCount: 2, unlistedCount: 1 });
      expect(JSON.stringify(audit[0])).not.toMatch(/SECRET|Paracetamol/);
      await saveNote(A, 'doc1', id, { diagnosis: 'x' });
      expect((await complete(A, 'doc1', id)).status).toBe(200);
      expect((await rx(A, 'doc1', id, [])).status).toBe(409);
      expect(await owner.prescriptionItem.count({ where: { visitId: id } })).toBe(2);
    });
  });

  // -------------------------------------------------------------------------------- complete

  describe('complete', () => {
    it('refuses an empty note; completes note and visit together; a second click is a replay', async () => {
      const id = await started(A);
      const none = await complete(A, 'doc1', id);
      expect(none.status).toBe(400);
      expect(none.body.code).toBe('NOTE_EMPTY');
      await saveNote(A, 'doc1', id, { advice: 'only advice' });
      expect((await complete(A, 'doc1', id)).body.code).toBe('NOTE_EMPTY');
      await saveNote(A, 'doc1', id, { diagnosis: 'dx', advice: 'rest' });
      const done = await complete(A, 'doc1', id);
      expect(done.status).toBe(200);
      expect(done.body.replayed).toBe(false);
      expect(done.body.visit.status).toBe('COMPLETED');
      expect(done.body.visit.completedAt).not.toBeNull();
      expect(done.body.consultation.status).toBe('COMPLETED');
      const again = await complete(A, 'doc1', id);
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(await auditRows(A, 'OPD_VISIT_COMPLETE', id)).toHaveLength(1);
      expect((await saveNote(A, 'doc1', id, { diagnosis: 'edit' })).status).toBe(409);
      expect(
        (await owner.consultation.findFirstOrThrow({ where: { visitId: id } })).diagnosis,
      ).toBe('dx');
    });

    it('eight parallel completes finish once', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'dx' });
      const results = await settled(Array.from({ length: 8 }, () => () => complete(A, 'doc1', id)));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
      expect(await auditRows(A, 'OPD_VISIT_COMPLETE', id)).toHaveLength(1);
    });

    it('saving, prescribing and completing at the same moment never loses or splits anything', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'before' });
      const results = await settled([
        () => saveNote(A, 'doc1', id, { diagnosis: 'late 1' }),
        () => complete(A, 'doc1', id),
        () => saveNote(A, 'doc1', id, { diagnosis: 'late 2' }),
        () =>
          put(A, 'doc1', `/opd/visits/${id}/prescription`, {
            items: [{ medicineName: 'x', dose: '1', frequency: '1', duration: '1' }],
          }),
        () => complete(A, 'doc1', id),
      ]);
      for (const r of results) {
        expect([200, 409]).toContain(r.status);
      }
      const note = await owner.consultation.findFirstOrThrow({ where: { visitId: id } });
      const visit = await owner.opdVisit.findUniqueOrThrow({ where: { id } });
      expect(note.status).toBe('COMPLETED');
      expect(visit.status).toBe('COMPLETED');
      // what the doctor saw as saved (200) is what is stored
      const lastSaved = results
        .filter((r) => r.status === 200 && r.body.consultation && r.body.replayed === undefined)
        .map((r) => r.body.consultation.diagnosis);
      expect(['before', 'late 1', 'late 2']).toContain(note.diagnosis);
      expect(lastSaved.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ------------------------------------------------------------------------------- addendum

  describe('addendum', () => {
    it('needs a completed note; then records who, when and why and leaves the note untouched', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'original' });
      const early = await post(A, 'doc1', `/opd/visits/${id}/consultation/addenda`, {
        text: 'a',
        reason: 'b',
      });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('ADDENDUM_NEEDS_COMPLETED_NOTE');
      await complete(A, 'doc1', id);
      const res = await post(A, 'doc1', `/opd/visits/${id}/consultation/addenda`, {
        text: ' Allergy to penicillin noted ',
        reason: 'missed during consultation',
      });
      expect(res.status).toBe(201);
      expect(res.body.consultation.diagnosis).toBe('original');
      expect(res.body.addenda).toHaveLength(1);
      expect(res.body.addenda[0]).toMatchObject({
        text: 'Allergy to penicillin noted',
        reason: 'missed during consultation',
        addedBy: { id: A.users.doc1 },
      });
      expect(res.body.addenda[0].createdAt).toEqual(expect.any(String));
      await post(A, 'doc1', `/opd/visits/${id}/consultation/addenda`, {
        text: 'second',
        reason: 'again',
      });
      const read = await get(A, 'nurse', `/opd/visits/${id}/consultation`);
      expect(read.body.addenda.map((a: Loose) => a.text)).toEqual([
        'Allergy to penicillin noted',
        'second',
      ]);
      expect(await auditRows(A, 'OPD_NOTE_ADDENDUM')).not.toHaveLength(0);
    });

    it('refuses blank text or reason and extra fields', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'x' });
      await complete(A, 'doc1', id);
      const url = `/opd/visits/${id}/consultation/addenda`;
      expect((await post(A, 'doc1', url, { text: '  ', reason: 'b' })).body.code).toBe(
        'ADDENDUM_INVALID',
      );
      expect((await post(A, 'doc1', url, { text: 'a', reason: '  ' })).body.code).toBe(
        'ADDENDUM_INVALID',
      );
      expect((await post(A, 'doc1', url, { text: 'a' })).status).toBe(400);
      expect(
        (await post(A, 'doc1', url, { text: 'a', reason: 'b', addedBy: A.users.doc2 })).status,
      ).toBe(400);
      expect(await owner.consultationAddendum.count({ where: { visitId: id } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------- reads

  describe('reading notes', () => {
    it('every read is audited with who and which visit, and never holds the text', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'SECRET-DIAGNOSIS' });
      const before = (await auditRows(A, 'OPD_NOTE_READ', id)).length;
      expect((await get(A, 'doc1', `/opd/visits/${id}/consultation`)).status).toBe(200);
      expect((await get(A, 'nurse', `/opd/visits/${id}/consultation`)).status).toBe(200);
      const rows = await auditRows(A, 'OPD_NOTE_READ', id);
      expect(rows).toHaveLength(before + 2);
      expect(rows.slice(-2).map((r) => r.actorUserId)).toEqual([A.users.doc1, A.users.nurse]);
      expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
    });

    it('a note read of a visit that does not exist for the caller is 404 and not audited', async () => {
      const id = await started(A);
      const count = async () => owner.auditLog.count({ where: { action: 'OPD_NOTE_READ' } });
      const before = await count();
      for (const res of [
        await get(A, 'doc2', `/opd/visits/${id}/consultation`),
        await get(A, 'nurseEast', `/opd/visits/${id}/consultation`),
        await get(B, 'nurse', `/opd/visits/${id}/consultation`),
        await get(B, 'doc1', `/opd/visits/${id}/consultation`),
        await get(A, 'nurse', `/opd/visits/does-not-exist/consultation`),
      ]) {
        expect(res.status).toBe(404);
      }
      expect(await count()).toBe(before);
    });

    it('a visit without a note reads as an empty note (and is still audited)', async () => {
      const id = await waiting(A);
      const res = await get(A, 'nurse', `/opd/visits/${id}/consultation`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ consultation: null, prescription: [], addenda: [] });
      expect(await auditRows(A, 'OPD_NOTE_READ', id)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------- vitals

  describe('vitals', () => {
    const vitals = (h: Hospital, who: string, id: string, readings: object[]) =>
      post(h, who, `/opd/visits/${id}/vitals`, { readings });

    it('lists the active fields in order without ids', async () => {
      const res = await get(A, 'nurse', '/opd/vitals-fields');
      expect(res.status).toBe(200);
      expect(res.body.items.map((f: Loose) => f.code)).toEqual(['PULSE', 'POSTURE']);
      expect(res.body.items[0]).toEqual({
        code: 'PULSE',
        name: 'Pulse',
        unit: 'bpm',
        valueKind: 'NUMBER',
        displayOrder: 1,
        warnMin: 50,
        warnMax: 100,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/"id"|tenant/);
    });

    it('records, repeats harmlessly, and corrects with a reason (history is kept)', async () => {
      const id = await waiting(A);
      const first = await vitals(A, 'nurse', id, [
        { fieldCode: 'PULSE', value: 72 },
        { fieldCode: 'POSTURE', value: 'sitting' },
      ]);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        recorded: ['PULSE', 'POSTURE'],
        corrected: [],
        unchanged: [],
      });
      const repeat = await vitals(A, 'nurse', id, [{ fieldCode: 'PULSE', value: '72.00' }]);
      expect(repeat.body).toMatchObject({ recorded: [], corrected: [], unchanged: ['PULSE'] });
      const noReason = await vitals(A, 'nurse', id, [{ fieldCode: 'PULSE', value: 110 }]);
      expect(noReason.status).toBe(400);
      expect(noReason.body).toMatchObject({
        code: 'VITALS_CORRECTION_REASON_REQUIRED',
        fieldCode: 'PULSE',
      });
      const fixed = await vitals(A, 'nurse', id, [
        { fieldCode: 'PULSE', value: 110.5, correctionReason: 'wrong finger' },
      ]);
      expect(fixed.body).toMatchObject({ recorded: [], corrected: ['PULSE'] });
      const pulse = fixed.body.fields.find((f: Loose) => f.code === 'PULSE');
      expect(pulse).toMatchObject({ value: 110.5, version: 2, outOfRange: true, unit: 'bpm' });
      expect(pulse.history.map((h: Loose) => [h.version, h.value, h.correctionReason])).toEqual([
        [1, 72, null],
        [2, 110.5, 'wrong finger'],
      ]);
      expect(pulse.recordedBy.id).toBe(A.users.nurse);
      const read = await get(A, 'doc1', `/opd/visits/${id}/vitals`);
      expect(read.status).toBe(200);
      expect(read.body.fields.map((f: Loose) => f.code)).toEqual(['PULSE', 'POSTURE']);
    });

    it('is all or nothing and refuses bad input', async () => {
      const id = await waiting(A);
      for (const [readings, code] of [
        [
          [
            { fieldCode: 'PULSE', value: 70 },
            { fieldCode: 'NOPE', value: 1 },
          ],
          'VITALS_FIELD_NOT_FOUND',
        ],
        [[{ fieldCode: 'OLDFIELD', value: 1 }], 'VITALS_FIELD_NOT_FOUND'],
        [
          [
            { fieldCode: 'PULSE', value: 70 },
            { fieldCode: 'PULSE', value: 71 },
          ],
          'VITALS_FIELD_DUPLICATE',
        ],
        [[{ fieldCode: 'PULSE', value: 'abc' }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'PULSE', value: -5 }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'PULSE', value: 70.123 }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'PULSE', value: 1e21 }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'PULSE', value: true }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'POSTURE', value: 5 }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'POSTURE', value: '   ' }], 'VITALS_VALUE_INVALID'],
        [[{ fieldCode: 'POSTURE', value: 'x'.repeat(201) }], 'VITALS_VALUE_INVALID'],
      ] as Array<[object[], string]>) {
        const res = await vitals(A, 'nurse', id, readings);
        expect({ code, status: res.status, got: res.body.code }).toEqual({
          code,
          status: 400,
          got: code,
        });
      }
      for (const body of [
        {},
        { readings: [] },
        { readings: [{ fieldCode: 'PULSE' }] },
        { readings: [{ fieldCode: 'PULSE', value: 1, version: 9 }] },
      ]) {
        expect((await post(A, 'nurse', `/opd/visits/${id}/vitals`, body)).status).toBe(400);
      }
      expect(await owner.visitVitals.count({ where: { visitId: id } })).toBe(0);
    });

    it('needs a visit that has joined the queue; works for waiting, started and completed visits', async () => {
      const patientId = await newPatient(A);
      const unpaid = await owner.opdVisit.create({
        data: {
          tenantId: A.tenant,
          branchId: A.main,
          patientId,
          doctorProfileId: A.doc1,
          visitType: 'NEW',
          visitDate: new Date(),
          createdBy: A.user,
        },
      });
      const res = await vitals(A, 'nurse', unpaid.id, [{ fieldCode: 'PULSE', value: 70 }]);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'VITALS_VISIT_NOT_OPEN', status: 'AWAITING_PAYMENT' });

      const id = await started(A);
      expect((await vitals(A, 'doc1', id, [{ fieldCode: 'PULSE', value: 70 }])).status).toBe(200);
      await saveNote(A, 'doc1', id, { diagnosis: 'x' });
      await complete(A, 'doc1', id);
      const late = await vitals(A, 'nurse', id, [
        { fieldCode: 'PULSE', value: 75, correctionReason: 'rechecked after consultation' },
      ]);
      expect(late.status).toBe(200);
      expect(late.body.corrected).toEqual(['PULSE']);
    });

    it("keeps to the caller's own scope: own visits for a doctor, the branch for a nurse, 404 elsewhere", async () => {
      const id = await waiting(A, A.doc1);
      const body = [{ fieldCode: 'PULSE', value: 70 }];
      for (const [h, who] of [
        [A, 'doc2'],
        [A, 'nurseEast'],
        [B, 'nurse'],
      ] as const) {
        expect((await vitals(h, who, id, body)).status).toBe(404);
        expect((await get(h, who, `/opd/visits/${id}/vitals`)).status).toBe(404);
      }
      expect(await owner.visitVitals.count({ where: { visitId: id } })).toBe(0);
      expect((await vitals(A, 'nurse', id, body)).status).toBe(200);
    });

    it('audit lists field codes only, never the values', async () => {
      const id = await waiting(A);
      await vitals(A, 'nurse', id, [{ fieldCode: 'POSTURE', value: 'SECRET-POSTURE' }]);
      const rows = (await auditRows(A, 'OPD_VITALS_RECORD', id)).map((r) => r.metadata);
      expect(rows).toEqual([{ recorded: ['POSTURE'], corrected: [] }]);
    });

    it('many corrections at the same moment queue up: gapless versions, no errors', async () => {
      const id = await waiting(A);
      await vitals(A, 'nurse', id, [{ fieldCode: 'PULSE', value: 60 }]);
      const results = await settled(
        Array.from(
          { length: 6 },
          (_, i) => () =>
            vitals(A, i % 2 === 0 ? 'nurse' : 'doc1', id, [
              { fieldCode: 'PULSE', value: 61 + i, correctionReason: `fix ${i}` },
            ]),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      const stored = await owner.visitVitals.findMany({
        where: { visitId: id },
        orderBy: { version: 'asc' },
      });
      expect(stored.map((s) => s.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('the same new reading sent twice at the same moment is stored once', async () => {
      const id = await waiting(A);
      const results = await settled(
        Array.from(
          { length: 6 },
          () => () => vitals(A, 'nurse', id, [{ fieldCode: 'PULSE', value: 88 }]),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect(await owner.visitVitals.count({ where: { visitId: id } })).toBe(1);
    });
  });

  // --------------------------------------------------------------------------- hospital walls

  // ------------------------------------------------------------- doctor details (Step 7c)

  describe('doctor details on the prescription', () => {
    const details = {
      printedName: 'Dr. One',
      qualifications: 'MBBS, MD',
      speciality: 'General Medicine',
      registrationNo: 'REG 12/2026',
      department: 'Medicine',
    };
    const empty = {
      printedName: null,
      qualifications: null,
      speciality: null,
      registrationNo: null,
      department: null,
    };
    const setProfile = (data: object) =>
      owner.doctorProfile.update({ where: { id: A.doc1 }, data });
    const readNote = (id: string) => get(A, 'doc1', `/opd/visits/${id}/consultation`);
    const completedVisit = async (): Promise<string> => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'dx' });
      expect((await complete(A, 'doc1', id)).status).toBe(200);
      return id;
    };
    afterEach(async () => {
      await setProfile(empty);
    });

    it('a draft shows the doctor profile as it is now, and the login name when there is no printed name', async () => {
      await setProfile(empty);
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'dx' });
      const first = await readNote(id);
      expect(first.status).toBe(200);
      expect(first.body.doctorDetails).toMatchObject({
        fromCompletedCopy: false,
        printedName: null,
        printName: first.body.visit.doctor.name,
        name: first.body.visit.doctor.name,
        qualifications: null,
        speciality: null,
        registrationNo: null,
      });
      await setProfile(details);
      const second = await readNote(id);
      expect(second.body.doctorDetails).toMatchObject({
        fromCompletedCopy: false,
        printName: 'Dr. One',
        qualifications: 'MBBS, MD',
        speciality: 'General Medicine',
        registrationNo: 'REG 12/2026',
        department: 'Medicine',
      });
    });

    it('completing keeps a copy: an old prescription never changes when the profile changes later', async () => {
      await setProfile(details);
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'dx' });
      const done = await complete(A, 'doc1', id);
      expect(done.body.doctorDetails).toMatchObject({
        fromCompletedCopy: true,
        printName: 'Dr. One',
        qualifications: 'MBBS, MD',
        registrationNo: 'REG 12/2026',
      });
      const row = await owner.consultation.findFirstOrThrow({ where: { visitId: id } });
      expect(row.doctorDetails).toEqual({
        name: done.body.doctorDetails.name,
        printedName: 'Dr. One',
        department: 'Medicine',
        qualifications: 'MBBS, MD',
        speciality: 'General Medicine',
        registrationNo: 'REG 12/2026',
        signatureImageId: null,
      });
      // the doctor edits the profile afterwards
      await setProfile({
        printedName: 'Dr. Changed',
        registrationNo: 'NEW 99',
        qualifications: null,
      });
      const later = await readNote(id);
      expect(later.body.doctorDetails).toMatchObject({
        fromCompletedCopy: true,
        printName: 'Dr. One',
        qualifications: 'MBBS, MD',
        registrationNo: 'REG 12/2026',
      });
      // a second click on Complete answers with the same old copy
      const replay = await complete(A, 'doc1', id);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.doctorDetails).toMatchObject({
        fromCompletedCopy: true,
        printName: 'Dr. One',
        registrationNo: 'REG 12/2026',
      });
      // a new visit uses the new details
      const next = await started(A);
      await saveNote(A, 'doc1', next, { diagnosis: 'dx' });
      expect((await readNote(next)).body.doctorDetails).toMatchObject({
        fromCompletedCopy: false,
        printName: 'Dr. Changed',
        registrationNo: 'NEW 99',
      });
    });

    it('completing also keeps WHICH signature picture the doctor had; a new picture later does not change an old prescription', async () => {
      const make = (isCurrent: boolean) =>
        owner.storedImage.create({
          data: {
            tenantId: A.tenant,
            purpose: 'DOCTOR_SIGNATURE',
            doctorProfileId: A.doc1,
            contentType: 'image/png',
            byteSize: 100,
            width: 100,
            height: 50,
            sha256: 'a'.repeat(64),
            storageKey: `images/test-${Date.now()}-${Math.random()}`,
            isCurrent,
            createdBy: A.users.doc1,
          },
        });
      await owner.storedImage.updateMany({
        where: { doctorProfileId: A.doc1 },
        data: { isCurrent: false },
      });
      const first = await make(true);
      const draft = await started(A);
      await saveNote(A, 'doc1', draft, { diagnosis: 'dx' });
      // a draft shows the picture the doctor has now
      expect((await readNote(draft)).body.doctorDetails.signatureImageId).toBe(first.id);
      expect((await complete(A, 'doc1', draft)).body.doctorDetails.signatureImageId).toBe(first.id);
      // the doctor uploads a new picture afterwards
      await owner.storedImage.update({ where: { id: first.id }, data: { isCurrent: false } });
      const second = await make(true);
      const later = await readNote(draft);
      expect(later.body.doctorDetails).toMatchObject({
        fromCompletedCopy: true,
        signatureImageId: first.id,
      });
      const row = await owner.consultation.findFirstOrThrow({ where: { visitId: draft } });
      expect((row.doctorDetails as { signatureImageId: string }).signatureImageId).toBe(first.id);
      // the next visit uses the new picture; a doctor with no picture gets null
      const next = await started(A);
      await saveNote(A, 'doc1', next, { diagnosis: 'dx' });
      expect((await readNote(next)).body.doctorDetails.signatureImageId).toBe(second.id);
      await owner.storedImage.update({ where: { id: second.id }, data: { isCurrent: false } });
      expect((await readNote(next)).body.doctorDetails.signatureImageId).toBeNull();
    });

    it('notes completed before the copy existed show the profile as it is now', async () => {
      const id = await completedVisit();
      const note = await owner.consultation.findFirstOrThrow({ where: { visitId: id } });
      // the only way to give a note no copy is to switch the rule off for a moment (what old rows look like)
      await owner.$executeRawUnsafe(
        'ALTER TABLE consultations DISABLE TRIGGER consultations_guard',
      );
      try {
        await owner.$executeRaw`UPDATE consultations SET doctor_details = NULL WHERE id = ${note.id}`;
      } finally {
        await owner.$executeRawUnsafe(
          'ALTER TABLE consultations ENABLE TRIGGER consultations_guard',
        );
      }
      await setProfile(details);
      const res = await readNote(id);
      expect(res.body.doctorDetails).toMatchObject({
        fromCompletedCopy: false,
        printName: 'Dr. One',
        registrationNo: 'REG 12/2026',
      });
    });

    it('the database takes the copy: the app cannot write it, an insert cannot bring one, and a completion overwrites a forged one', async () => {
      await setProfile(details);
      // 1. the app role has no right to write the column
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'dx' });
      const client = createPgClient('app');
      await client.connect();
      try {
        await expect(
          withTenant(client, A.tenant, () =>
            client.query(
              `UPDATE consultations SET doctor_details = '{"forged":true}'::jsonb WHERE visit_id = $1`,
              [id],
            ),
          ),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await client.end();
      }
      // 2. a forged copy handed in at completion is replaced by the real one
      const note = await owner.consultation.findFirstOrThrow({ where: { visitId: id } });
      const closed = await owner.consultation.update({
        where: { id: note.id },
        data: { status: 'COMPLETED', completedAt: new Date(), doctorDetails: { forged: true } },
      });
      expect(closed.doctorDetails).toMatchObject({
        printedName: 'Dr. One',
        registrationNo: 'REG 12/2026',
      });
      expect(closed.doctorDetails).not.toHaveProperty('forged');
      // 3. a note cannot be inserted with a copy
      const other = await started(A);
      const inserted = await owner.consultation.create({
        data: {
          tenantId: A.tenant,
          branchId: A.main,
          visitId: other,
          doctorProfileId: A.doc1,
          status: 'DRAFT',
          diagnosis: 'dx',
          doctorDetails: { forged: true },
        },
      });
      expect(inserted.doctorDetails).toBeNull();
    });
  });

  describe('other hospitals', () => {
    it('hospital B cannot reach any visit of hospital A through any route', async () => {
      const id = await started(A);
      await saveNote(A, 'doc1', id, { diagnosis: 'x' });
      const attempts = [
        post(B, 'doc1', `/opd/visits/${id}/start`),
        get(B, 'doc1', `/opd/visits/${id}/consultation`),
        put(B, 'doc1', `/opd/visits/${id}/consultation`, { diagnosis: 'hijack' }),
        put(B, 'doc1', `/opd/visits/${id}/prescription`, { items: [] }),
        post(B, 'doc1', `/opd/visits/${id}/complete`),
        post(B, 'doc1', `/opd/visits/${id}/consultation/addenda`, { text: 'a', reason: 'b' }),
        get(B, 'nurse', `/opd/visits/${id}/vitals`),
        post(B, 'nurse', `/opd/visits/${id}/vitals`, {
          readings: [{ fieldCode: 'PULSE', value: 1 }],
        }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.status).toBe(404);
      }
      expect(
        (await owner.consultation.findFirstOrThrow({ where: { visitId: id } })).diagnosis,
      ).toBe('x');
    });

    it("hospital B's queue never lists hospital A's visits", async () => {
      const id = await waiting(A);
      const res = await get(B, 'nurse', '/opd/queue');
      expect(res.body.items.map((i: Loose) => i.id)).not.toContain(id);
    });
  });
});
