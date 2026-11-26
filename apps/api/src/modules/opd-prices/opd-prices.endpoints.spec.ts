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
import { ensureSystemRolesForTenant } from '../../../prisma/seeds/reference';
import {
  defaultStarterOptions,
  runHospitalStarter,
} from '../../database/hospital-starter/hospital-starter';
import { localDate } from './local-date';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the price tests`);
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

const RECEPTION_PERMS = [
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'patients.registry.read',
] as const;

type Hospital = {
  tenant: string;
  main: string;
  adminId: string;
  tokens: Record<'admin' | 'branchAdmin' | 'recv' | 'nobody', string>;
  regItem: string;
  testNoPrice: string;
  testPriced: string;
  testInactive: string;
  consultationItem: string;
  doc1: string;
  doc2: string;
  docInactive: string;
};

describe('OPD prices: list, history and change (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}${stamp}${(seq += 1)}`;
  let A: Hospital;
  let B: Hospital;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => localDate(clock.now(), 'Asia/Kolkata');
  const addDays = (date: string, days: number): string => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** A hospital as the runbook describes it, plus the people the tests need. */
  async function baseHospital(label: string): Promise<{
    tenant: string;
    main: string;
    code: string;
    adminId: string;
    superAdminRoleId: string;
    branchAdminRoleId: string;
  }> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const code = `PR_${label}_${stamp}`;
    const hospital = await owner.hospital.create({
      data: {
        code,
        name: `Prices ${label}`,
        isTest: true,
        branches: {
          create: [{ code: 'MAIN', name: 'Main', isMain: true, accessCode: uniq(`pr-${label}-`) }],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const main = hospital.branches[0]!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    await owner.branchModule.create({
      data: { tenantId: tenant, branchId: main, moduleId: opd.id, enabledByIndigo: true },
    });
    const { superAdminRoleId, branchAdminRoleId } = await ensureSystemRolesForTenant(owner, tenant);
    const admin = await owner.user.create({
      data: {
        tenantId: tenant,
        code: 'SA1',
        email: `${uniq('sa')}@example.test`,
        displayName: 'First SuperAdmin',
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({ data: { tenantId: tenant, userId: admin.id, branchId: main } });
    await owner.roleAssignment.create({
      data: { tenantId: tenant, userId: admin.id, roleId: superAdminRoleId, scopeType: 'HOSPITAL' },
    });
    return { tenant, main, code, adminId: admin.id, superAdminRoleId, branchAdminRoleId };
  }

  async function makeUser(
    base: { tenant: string; main: string },
    key: string,
    opts: { permissions?: readonly string[]; branchRoleId?: string } = {},
  ): Promise<{ id: string; token: string }> {
    const u = await owner.user.create({
      data: {
        tenantId: base.tenant,
        code: `${key}${stamp}${(seq += 1)}`.slice(0, 40),
        email: `${uniq(key)}@example.test`,
        displayName: `Person ${key}`,
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({
      data: { tenantId: base.tenant, userId: u.id, branchId: base.main },
    });
    let roleId = opts.branchRoleId;
    if (!roleId && opts.permissions && opts.permissions.length > 0) {
      const perms = await owner.permission.findMany({
        where: { code: { in: [...opts.permissions] } },
      });
      const role = await owner.role.create({
        data: { tenantId: base.tenant, code: uniq(`R_${key}_`), name: key },
      });
      for (const p of perms) {
        await owner.rolePermission.create({
          data: { tenantId: base.tenant, roleId: role.id, permissionId: p.id },
        });
      }
      roleId = role.id;
    }
    if (roleId) {
      const a = await owner.roleAssignment.create({
        data: { tenantId: base.tenant, userId: u.id, roleId, scopeType: 'BRANCH' },
      });
      await owner.roleAssignmentBranch.create({
        data: { tenantId: base.tenant, assignmentId: a.id, branchId: base.main },
      });
    }
    return {
      id: u.id,
      token: tokenService.signHospitalAccess({
        tenantId: base.tenant,
        userId: u.id,
        branchId: base.main,
      }),
    };
  }

  async function makeDoctor(
    base: { tenant: string; main: string },
    key: string,
    opts: { active?: boolean } = {},
  ): Promise<string> {
    const u = await makeUser(base, key, { permissions: ['opd.visits.read'] });
    const profile = await owner.doctorProfile.create({
      data: {
        tenantId: base.tenant,
        userId: u.id,
        code: uniq(`DOC_${key}_`),
        active: opts.active ?? true,
      },
    });
    return profile.id;
  }

  async function seedHospital(label: string): Promise<Hospital> {
    const base = await baseHospital(label);
    const { tenant } = base;
    await owner.opdSettings.create({
      data: { tenantId: tenant, followUpFreeDays: 7, tokenPrefix: 'T', timezone: 'Asia/Kolkata' },
    });
    const item = async (
      code: string,
      name: string,
      kind: 'REGISTRATION' | 'INVESTIGATION' | 'CONSULTATION',
      active = true,
    ) =>
      (await owner.chargeItem.create({ data: { tenantId: tenant, code, name, kind, active } })).id;
    const regItem = await item('REG', 'Registration', 'REGISTRATION');
    const testNoPrice = await item('TA', 'Blood sugar', 'INVESTIGATION');
    const testPriced = await item('TB', 'X-ray chest', 'INVESTIGATION');
    const testInactive = await item('TOFF', 'Old test', 'INVESTIGATION', false);
    const consultationItem = await item('CONS', 'Consultation', 'CONSULTATION');
    await owner.chargeItemPrice.create({
      data: {
        tenantId: tenant,
        chargeItemId: testPriced,
        amountPaise: 30_000,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        createdBy: base.adminId,
      },
    });
    const doc1 = await makeDoctor(base, 'doc1');
    const doc2 = await makeDoctor(base, 'doc2');
    const docInactive = await makeDoctor(base, 'docoff', { active: false });
    for (const [doctor, type, amount] of [
      [doc1, 'NEW', 50_000],
      [doc1, 'FOLLOW_UP', 30_000],
    ] as const) {
      await owner.doctorFee.create({
        data: {
          tenantId: tenant,
          doctorProfileId: doctor,
          visitType: type,
          amountPaise: amount,
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          createdBy: base.adminId,
        },
      });
    }
    const branchAdmin = await makeUser(base, 'badmin', { branchRoleId: base.branchAdminRoleId });
    const recv = await makeUser(base, 'recv', { permissions: RECEPTION_PERMS });
    const nobody = await makeUser(base, 'nobody');
    return {
      tenant,
      main: base.main,
      adminId: base.adminId,
      tokens: {
        admin: tokenService.signHospitalAccess({
          tenantId: tenant,
          userId: base.adminId,
          branchId: base.main,
        }),
        branchAdmin: branchAdmin.token,
        recv: recv.token,
        nobody: nobody.token,
      },
      regItem,
      testNoPrice,
      testPriced,
      testInactive,
      consultationItem,
      doc1,
      doc2,
      docInactive,
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

  const versionsOf = (item: string) =>
    owner.chargeItemPrice.findMany({
      where: { chargeItemId: item },
      orderBy: { effectiveFrom: 'asc' },
    });

  // ------------------------------------------------------------------ who may use it

  it('is for Admin and SuperAdmin only: others get 403, no token gets 401, for every route', async () => {
    const calls: Array<() => request.Test> = [
      () => http().get('/opd/prices'),
      () => http().get(`/opd/prices/history?itemId=${A.regItem}`),
      () => http().post(`/opd/prices/items/${A.regItem}`).send({ amountPaise: 100 }),
      () =>
        http()
          .post('/opd/prices/doctor-fees')
          .send({ doctorProfileId: A.doc1, visitType: 'NEW', amountPaise: 100 }),
    ];
    for (const call of calls) {
      await call().expect(401);
      await call().set(auth(A.tokens.recv)).expect(403);
      await call().set(auth(A.tokens.nobody)).expect(403);
    }
    // nothing was written
    expect(await versionsOf(A.regItem)).toHaveLength(0);
  });

  it('a SuperAdmin and a Branch Admin may change prices (prices are hospital-wide)', async () => {
    await http()
      .post(`/opd/prices/items/${A.testNoPrice}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 12_000 })
      .expect(200);
    clock.set(new Date(clock.now().getTime() + 1000));
    await http()
      .post(`/opd/prices/items/${A.testNoPrice}`)
      .set(auth(A.tokens.branchAdmin))
      .send({ amountPaise: 13_000 })
      .expect(200);
    expect((await versionsOf(A.testNoPrice)).map((v) => v.amountPaise)).toEqual([12_000, 13_000]);
  });

  // ------------------------------------------------------------------------- list

  it('with branchId lists only doctors who work in that branch (a doctor in two branches shows in both)', async () => {
    const C = await seedHospital('C');
    const east = await owner.branch.create({
      data: { tenantId: C.tenant, code: 'EAST', name: 'East', accessCode: uniq('pr-east-') },
    });
    const userOf = async (profile: string) =>
      (await owner.doctorProfile.findUniqueOrThrow({ where: { id: profile } })).userId;
    // doc1 works in Main and East; doc3 in East only; doc2 stays in Main only
    await owner.userBranch.create({
      data: { tenantId: C.tenant, userId: await userOf(C.doc1), branchId: east.id },
    });
    const doc3 = await makeDoctor({ tenant: C.tenant, main: C.main }, 'doc3east');
    const doc3User = await userOf(doc3);
    await owner.userBranch.updateMany({
      where: { tenantId: C.tenant, userId: doc3User, branchId: C.main },
      data: { isActive: false },
    });
    await owner.userBranch.create({
      data: { tenantId: C.tenant, userId: doc3User, branchId: east.id },
    });

    const doctorsOf = async (query: string): Promise<string[]> => {
      const res = await http()
        .get(`/opd/prices?kind=DOCTOR_FEE&pageSize=100${query}`)
        .set(auth(C.tokens.admin))
        .expect(200);
      return [
        ...new Set<string>(
          res.body.items.map((i: { doctorProfileId: string }) => i.doctorProfileId),
        ),
      ];
    };

    const inMain = await doctorsOf(`&branchId=${C.main}`);
    expect(inMain).toContain(C.doc1);
    expect(inMain).toContain(C.doc2);
    expect(inMain).not.toContain(doc3);
    const inEast = await doctorsOf(`&branchId=${east.id}`);
    expect(inEast.sort()).toEqual([C.doc1, doc3].sort());
    // no branchId, or an empty one: everyone, as before
    for (const q of ['', '&branchId=']) {
      const everyone = await doctorsOf(q);
      expect(everyone).toEqual(expect.arrayContaining([C.doc1, C.doc2, doc3]));
    }
    // the registration fee and the tests are hospital-wide: not filtered
    const rest = await http()
      .get(`/opd/prices?pageSize=100&branchId=${east.id}`)
      .set(auth(C.tokens.admin))
      .expect(200);
    const kinds = new Set(rest.body.items.map((i: { kind: string }) => i.kind));
    expect(kinds.has('REGISTRATION')).toBe(true);
    expect(kinds.has('INVESTIGATION')).toBe(true);
    // a doctor fee is still the doctor's own, whatever the branch
    const fees = await http()
      .get(`/opd/prices?kind=DOCTOR_FEE&pageSize=100&branchId=${east.id}`)
      .set(auth(C.tokens.admin))
      .expect(200);
    const doc1New = fees.body.items.find(
      (i: { doctorProfileId: string; visitType: string }) =>
        i.doctorProfileId === C.doc1 && i.visitType === 'NEW',
    );
    expect(doc1New.currentAmountPaise).toBe(50_000);
  });

  it('refuses a branch of another hospital or an unknown one (400, nothing leaks)', async () => {
    for (const branchId of [B.main, 'no-such-branch']) {
      const res = await http()
        .get(`/opd/prices?branchId=${branchId}`)
        .set(auth(A.tokens.admin))
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'PRICE_INVALID',
        field: 'branchId',
        reason: 'BRANCH_NOT_FOUND',
      });
    }
  });

  it('lists the registration fee, tests and doctor fees with search, filter and pages', async () => {
    const all = await http().get('/opd/prices?pageSize=100').set(auth(A.tokens.admin)).expect(200);
    expect(all.body.today).toBe(today());
    const kinds = new Set((all.body.items as Array<{ kind: string }>).map((i) => i.kind));
    expect(kinds).toEqual(new Set(['REGISTRATION', 'INVESTIGATION', 'DOCTOR_FEE']));
    // inactive tests and consultation items are not listed; inactive doctors are not listed
    const codes = (all.body.items as Array<{ code: string }>).map((i) => i.code);
    expect(codes).not.toContain('TOFF');
    expect(codes).not.toContain('CONS');
    expect(all.body.items.filter((i: { kind: string }) => i.kind === 'DOCTOR_FEE')).toHaveLength(4); // doc1, doc2 x 2 types
    const priced = (
      all.body.items as Array<{ code: string; currentAmountPaise: number | null }>
    ).find((i) => i.code === 'TB')!;
    expect(priced.currentAmountPaise).toBe(30_000);

    const search = await http().get('/opd/prices?q=xray').set(auth(A.tokens.admin)).expect(200);
    expect(search.body.total).toBe(0);
    const search2 = await http().get('/opd/prices?q=X-RAY').set(auth(A.tokens.admin)).expect(200);
    expect(search2.body.items.map((i: { code: string }) => i.code)).toEqual(['TB']);
    // a search with % or _ is plain text, not a pattern
    const wild = await http().get('/opd/prices?q=%25').set(auth(A.tokens.admin)).expect(200);
    expect(wild.body.total).toBe(0);

    const onlyFees = await http()
      .get('/opd/prices?kind=DOCTOR_FEE&pageSize=3&page=2')
      .set(auth(A.tokens.admin))
      .expect(200);
    expect(onlyFees.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(onlyFees.body.items).toHaveLength(1);
    await http().get('/opd/prices?kind=NOPE').set(auth(A.tokens.admin)).expect(400);
  });

  it('never shows another hospital: its items are not listed and cannot be read or changed', async () => {
    const listB = await http()
      .get('/opd/prices?pageSize=100')
      .set(auth(B.tokens.admin))
      .expect(200);
    const idsA = new Set([A.regItem, A.testPriced, A.testNoPrice]);
    for (const row of listB.body.items as Array<{ itemId: string | null }>) {
      expect(idsA.has(row.itemId ?? '')).toBe(false);
    }
    await http()
      .get(`/opd/prices/history?itemId=${A.testPriced}`)
      .set(auth(B.tokens.admin))
      .expect(404);
    await http()
      .post(`/opd/prices/items/${A.testPriced}`)
      .set(auth(B.tokens.admin))
      .send({ amountPaise: 1 })
      .expect(404);
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(B.tokens.admin))
      .send({ doctorProfileId: A.doc1, visitType: 'NEW', amountPaise: 1 })
      .expect(404);
    expect((await versionsOf(A.testPriced)).map((v) => v.amountPaise)).toEqual([30_000]);
  });

  // ---------------------------------------------------------------------- changes

  it('adds a new version, never edits or deletes: the old one stays and old bills keep their price', async () => {
    const first = await http()
      .post(`/opd/prices/items/${A.regItem}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 10_000 })
      .expect(200);
    expect(first.body).toMatchObject({ changed: true, previousAmountPaise: null });
    clock.set(new Date(clock.now().getTime() + 60_000));
    const second = await http()
      .post(`/opd/prices/items/${A.regItem}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 15_000 })
      .expect(200);
    expect(second.body).toMatchObject({ changed: true, previousAmountPaise: 10_000 });
    const versions = await versionsOf(A.regItem);
    expect(versions.map((v) => v.amountPaise)).toEqual([10_000, 15_000]);
    // the earlier version is untouched
    expect(versions[0]!.id).toBe(first.body.price.id);
    const history = await http()
      .get(`/opd/prices/history?itemId=${A.regItem}`)
      .set(auth(A.tokens.admin))
      .expect(200);
    expect(history.body.items.map((v: { amountPaise: number }) => v.amountPaise)).toEqual([
      15_000, 10_000,
    ]);
    expect(history.body.items[0]).toMatchObject({ inEffect: true });
    expect(history.body.items[1]).toMatchObject({ inEffect: false });
    expect(history.body.items[0].createdByName).toBe('First SuperAdmin');
    // append-only is enforced by the database for every login, the owner included
    await expect(
      owner.chargeItemPrice.update({ where: { id: versions[0]!.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow(/append-only/i);
    await expect(owner.chargeItemPrice.delete({ where: { id: versions[0]!.id } })).rejects.toThrow(
      /append-only/i,
    );
  });

  it('the same amount again (a repeated request) creates no new version and no new audit row', async () => {
    await http()
      .post(`/opd/prices/items/${A.testPriced}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 30_000 })
      .expect(200)
      .expect((res) =>
        expect(res.body).toMatchObject({ changed: false, previousAmountPaise: 30_000 }),
      );
    expect(await versionsOf(A.testPriced)).toHaveLength(1);
    const audits = () =>
      owner.auditLog.count({ where: { tenantId: A.tenant, entityType: 'charge_item_price' } });
    const before = await audits();
    clock.set(new Date(clock.now().getTime() + 1000));
    await http()
      .post(`/opd/prices/items/${A.testPriced}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 31_000 })
      .expect(200);
    for (let i = 0; i < 2; i += 1) {
      await http()
        .post(`/opd/prices/items/${A.testPriced}`)
        .set(auth(A.tokens.admin))
        .send({ amountPaise: 31_000 })
        .expect(200)
        .expect((res) => expect(res.body.changed).toBe(false));
    }
    expect(await versionsOf(A.testPriced)).toHaveLength(2);
    expect(await audits()).toBe(before + 1);
  });

  it('writes an audit row with ids and amounts only (no names, no free text)', async () => {
    clock.set(new Date(clock.now().getTime() + 2000));
    const res = await http()
      .post(`/opd/prices/doctor-fees`)
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: A.doc1, visitType: 'NEW', amountPaise: 55_000 })
      .expect(200);
    const row = await owner.auditLog.findFirstOrThrow({
      where: { tenantId: A.tenant, entityId: res.body.price.id },
    });
    expect(row.action).toBe('OPD_DOCTOR_FEE_CHANGE');
    expect(row.actorUserId).toBe(A.adminId);
    expect(row.metadata).toMatchObject({
      doctorProfileId: A.doc1,
      visitType: 'NEW',
      oldAmountPaise: 50_000,
      newAmountPaise: 55_000,
    });
    expect((row.metadata as { branchId: unknown }).branchId).toBeNull();
    expect(Object.keys(row.metadata as object).sort()).toEqual([
      'branchId',
      'doctorProfileId',
      'effectiveFrom',
      'newAmountPaise',
      'oldAmountPaise',
      'visitType',
    ]);
  });

  it('keeps NEW and FOLLOW_UP fees apart; unknown, other-hospital and inactive doctors are refused', async () => {
    clock.set(new Date(clock.now().getTime() + 3000));
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: A.doc2, visitType: 'FOLLOW_UP', amountPaise: 20_000 })
      .expect(200)
      .expect((res) => expect(res.body.previousAmountPaise).toBeNull());
    const rows = await owner.doctorFee.findMany({ where: { doctorProfileId: A.doc2 } });
    expect(rows.map((r) => r.visitType)).toEqual(['FOLLOW_UP']);
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: 'no_such_doctor', visitType: 'NEW', amountPaise: 1 })
      .expect(404);
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: A.docInactive, visitType: 'NEW', amountPaise: 1 })
      .expect(400)
      .expect((res) =>
        expect(res.body).toMatchObject({ code: 'PRICE_INVALID', reason: 'ITEM_INACTIVE' }),
      );
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: A.doc1, visitType: 'ANY', amountPaise: 1 })
      .expect(400);
  });

  it('refuses bad amounts: whole paise only, 0 or more, within the limit', async () => {
    const bad = [-1, 10.5, '100', null, 2_147_483_648, {}, [1]];
    for (const amountPaise of bad) {
      await http()
        .post(`/opd/prices/items/${A.testNoPrice}`)
        .set(auth(A.tokens.admin))
        .send({ amountPaise })
        .expect(400);
    }
    await http()
      .post(`/opd/prices/items/${A.testNoPrice}`)
      .set(auth(A.tokens.admin))
      .send({})
      .expect(400);
    await http()
      .post(`/opd/prices/items/${A.testNoPrice}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 100, hospitalId: 'other' })
      .expect(400);
    // zero is a real price (a free item)
    clock.set(new Date(clock.now().getTime() + 4000));
    await http()
      .post(`/opd/prices/items/${A.testNoPrice}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 0 })
      .expect(200);
  });

  it('refuses an inactive item, a consultation item and an unknown item', async () => {
    await http()
      .post(`/opd/prices/items/${A.testInactive}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 5 })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('ITEM_INACTIVE'));
    await http()
      .post(`/opd/prices/items/${A.consultationItem}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 5 })
      .expect(404);
    await http()
      .post('/opd/prices/items/no_such_item')
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 5 })
      .expect(404);
    await http()
      .post('/opd/prices/items/bad%20id!')
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 5 })
      .expect(400);
  });

  // ------------------------------------------------------------ the effective date rule

  it('effective date: not before today (hospital time), except the very first price', async () => {
    const item = await owner.chargeItem.create({
      data: { tenantId: A.tenant, code: uniq('DT'), name: 'Date test', kind: 'INVESTIGATION' },
    });
    const change = (body: Record<string, unknown>) =>
      http().post(`/opd/prices/items/${item.id}`).set(auth(A.tokens.admin)).send(body);

    // not a real date, wrong format
    await change({ amountPaise: 100, effectiveFrom: '2026-02-30' })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('DATE_INVALID'));
    await change({ amountPaise: 100, effectiveFrom: '30-02-2026' }).expect(400);
    // the very first price may be dated in the past
    const past = addDays(today(), -30);
    const first = await change({ amountPaise: 100, effectiveFrom: past }).expect(200);
    expect(new Date(first.body.price.effectiveFrom).getTime()).toBeLessThan(clock.now().getTime());
    // any later price may not
    await change({ amountPaise: 200, effectiveFrom: past })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('DATE_IN_PAST'));
    await change({ amountPaise: 200, effectiveFrom: addDays(today(), -1) })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('DATE_IN_PAST'));
    // a date far ahead is refused (it would block every later change)
    await change({ amountPaise: 250, effectiveFrom: addDays(today(), 400) })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('DATE_TOO_FAR'));
    // a future date schedules a price: the current price stays until that day
    const future = addDays(today(), 10);
    await change({ amountPaise: 300, effectiveFrom: future }).expect(200);
    const row = await http()
      .get(`/opd/prices?q=${encodeURIComponent('Date test')}`)
      .set(auth(A.tokens.admin))
      .expect(200);
    expect(row.body.items[0]).toMatchObject({
      currentAmountPaise: 100,
      nextAmountPaise: 300,
    });
    // today is now earlier than the scheduled price: refused (change the scheduled one's day instead)
    await change({ amountPaise: 400 })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('DATE_BEFORE_LATEST'));
    // the same future day with another amount: a version already starts that day
    await change({ amountPaise: 500, effectiveFrom: future })
      .expect(400)
      .expect((res) => expect(res.body.reason).toBe('VERSION_EXISTS'));
    // a later day is fine
    await change({ amountPaise: 600, effectiveFrom: addDays(today(), 20) }).expect(200);
    expect(
      (await owner.chargeItemPrice.findMany({ where: { chargeItemId: item.id } })).map(
        (v) => v.amountPaise,
      ),
    ).toEqual(expect.arrayContaining([100, 300, 600]));
  });

  it('the first price of an item starts now when no date is given, and a later price of the next day starts at midnight of that day', async () => {
    const item = await owner.chargeItem.create({
      data: { tenantId: A.tenant, code: uniq('NW'), name: 'Now test', kind: 'INVESTIGATION' },
    });
    const res = await http()
      .post(`/opd/prices/items/${item.id}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 700 })
      .expect(200);
    expect(res.body.price.effectiveFrom).toBe(clock.now().toISOString());
    const tomorrow = addDays(today(), 1);
    const next = await http()
      .post(`/opd/prices/items/${item.id}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 800, effectiveFrom: tomorrow })
      .expect(200);
    // 00:00 Asia/Kolkata of that date is 18:30 UTC of the day before
    expect(next.body.price.effectiveFrom).toBe(
      new Date(`${addDays(tomorrow, -1)}T18:30:00.000Z`).toISOString(),
    );
  });

  // ----------------------------------------------------------------- concurrency

  it('two identical changes at the same moment create exactly one version', async () => {
    const item = await owner.chargeItem.create({
      data: { tenantId: A.tenant, code: uniq('CC'), name: 'Race same', kind: 'INVESTIGATION' },
    });
    const send = () =>
      http()
        .post(`/opd/prices/items/${item.id}`)
        .set(auth(A.tokens.admin))
        .send({ amountPaise: 900 });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.changed, b.body.changed].sort()).toEqual([false, true]);
    expect(await versionsOf(item.id)).toHaveLength(1);
  });

  it('two different changes at the same moment: one wins, the other is refused cleanly, no duplicate', async () => {
    const item = await owner.chargeItem.create({
      data: { tenantId: A.tenant, code: uniq('CD'), name: 'Race diff', kind: 'INVESTIGATION' },
    });
    const send = (amountPaise: number) =>
      http().post(`/opd/prices/items/${item.id}`).set(auth(A.tokens.admin)).send({ amountPaise });
    const [a, b] = await Promise.all([send(1000), send(2000)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const refused = a.status === 400 ? a : b;
    expect(refused.body).toMatchObject({ code: 'PRICE_INVALID', reason: 'VERSION_EXISTS' });
    expect(await versionsOf(item.id)).toHaveLength(1);
  });

  // ----------------------------------------------------------- history input checks

  it('history needs exactly one target and a valid visit type', async () => {
    await http().get('/opd/prices/history').set(auth(A.tokens.admin)).expect(400);
    await http()
      .get(`/opd/prices/history?itemId=${A.regItem}&visitType=NEW`)
      .set(auth(A.tokens.admin))
      .expect(400);
    await http()
      .get(`/opd/prices/history?doctorProfileId=${A.doc1}&visitType=BOTH`)
      .set(auth(A.tokens.admin))
      .expect(400);
    const fee = await http()
      .get(`/opd/prices/history?doctorProfileId=${A.doc1}&visitType=NEW`)
      .set(auth(A.tokens.admin))
      .expect(200);
    expect(fee.body.items.length).toBeGreaterThan(0);
  });

  // ------------------------------------------- a brand-new hospital can complete a first visit

  it('a brand-new empty hospital completes a first visit after the starter script, a registration price and a doctor fee', async () => {
    const base = await baseHospital('NEW');
    const doctor = await makeDoctor(base, 'newdoc');
    const recv = await makeUser(base, 'newrecv', { permissions: RECEPTION_PERMS });
    const patient = await owner.patient.create({
      data: {
        tenantId: base.tenant,
        uhid: uniq('NEWP'),
        registeredBranchId: base.main,
        name: 'First Patient',
        phone: '+919800000001',
        createdBy: base.adminId,
      },
    });
    const adminToken = tokenService.signHospitalAccess({
      tenantId: base.tenant,
      userId: base.adminId,
      branchId: base.main,
    });
    const visit = (key: string, who = recv.token) =>
      http().post('/opd/visits').set(auth(who)).send({
        patientId: patient.id,
        doctorProfileId: doctor,
        visitType: 'NEW',
        idempotencyKey: key,
      });

    // 1. without the starter data a visit cannot be billed
    await visit(uniq('k')).expect(409);

    // 2. the starter script, then still no prices
    await runHospitalStarter(owner, defaultStarterOptions(base.code));
    await visit(uniq('k'))
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('FEE_NOT_CONFIGURED'));

    // 3. the registration price and the doctor fee, from the new routes
    const list = await http()
      .get('/opd/prices?kind=REGISTRATION')
      .set(auth(adminToken))
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    const regId = list.body.items[0].itemId as string;
    await http()
      .post(`/opd/prices/items/${regId}`)
      .set(auth(adminToken))
      .send({ amountPaise: 10_000 })
      .expect(200);
    for (const [visitType, amountPaise] of [
      ['NEW', 50_000],
      ['FOLLOW_UP', 30_000],
    ] as const) {
      await http()
        .post('/opd/prices/doctor-fees')
        .set(auth(adminToken))
        .send({ doctorProfileId: doctor, visitType, amountPaise })
        .expect(200);
    }

    // 4. now the first visit works: registration fee + consultation, paid, waiting
    const first = await visit(uniq('k')).expect(201);
    expect(first.body.status).toBe('WAITING');
    expect(first.body.bill.totalPaise).toBe(60_000);
    expect(first.body.bill.paymentStatus).toBe('PAID');

    // 5. a later price change is for NEW bills only: the first bill keeps its price
    clock.set(new Date(clock.now().getTime() + 120_000));
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(adminToken))
      .send({ doctorProfileId: doctor, visitType: 'NEW', amountPaise: 70_000 })
      .expect(200);
    const lines = await owner.billLine.findMany({
      where: { tenantId: base.tenant, billId: first.body.bill.id },
    });
    expect(lines.map((l) => l.lineTotalPaise).sort((x, y) => x - y)).toEqual([10_000, 50_000]);
    const bill = await owner.bill.findUniqueOrThrow({ where: { id: first.body.bill.id } });
    expect(bill.totalPaise).toBe(60_000);
  });

  // ------------------------------------------- the follow-up fee is optional (Step 8c)

  it('a doctor with only a new-visit fee: the follow-up fee is the same price until a separate one is set, and then it stays put', async () => {
    const doctor = await makeDoctor(A, 'fallback');
    const code = (await owner.doctorProfile.findUniqueOrThrow({ where: { id: doctor } })).code;
    const rows = async () =>
      (
        await http()
          .get(`/opd/prices?kind=DOCTOR_FEE&q=${code}`)
          .set(auth(A.tokens.admin))
          .expect(200)
      ).body.items as Array<{
        visitType: string;
        currentAmountPaise: number | null;
        followsBase: boolean;
      }>;
    const pick = async (type: string) => (await rows()).find((r) => r.visitType === type)!;
    const doctorsList = async () =>
      (await http().get('/opd/doctors').set(auth(A.tokens.recv)).expect(200)).body.items.find(
        (d: { id: string }) => d.id === doctor,
      ) as { feeNewPaise: number | null; feeFollowUpPaise: number | null };

    // nothing set yet
    expect(await pick('FOLLOW_UP')).toMatchObject({ currentAmountPaise: null, followsBase: true });

    // only the new-visit fee: the follow-up row shows the same price, marked as following it
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: doctor, visitType: 'NEW', amountPaise: 40_000 })
      .expect(200);
    expect(await pick('NEW')).toMatchObject({ currentAmountPaise: 40_000, followsBase: false });
    expect(await pick('FOLLOW_UP')).toMatchObject({
      currentAmountPaise: 40_000,
      followsBase: true,
    });
    expect(await doctorsList()).toMatchObject({ feeNewPaise: 40_000, feeFollowUpPaise: 40_000 });

    // a later change of the new-visit fee is followed by the follow-up fee
    clock.set(new Date(clock.now().getTime() + 120_000));
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: doctor, visitType: 'NEW', amountPaise: 45_000 })
      .expect(200);
    expect(await pick('FOLLOW_UP')).toMatchObject({
      currentAmountPaise: 45_000,
      followsBase: true,
    });

    // a separate follow-up fee: its own price from now on
    clock.set(new Date(clock.now().getTime() + 120_000));
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: doctor, visitType: 'FOLLOW_UP', amountPaise: 25_000 })
      .expect(200);
    expect(await pick('FOLLOW_UP')).toMatchObject({
      currentAmountPaise: 25_000,
      followsBase: false,
    });

    // ... and it no longer follows later changes of the new-visit fee
    clock.set(new Date(clock.now().getTime() + 120_000));
    await http()
      .post('/opd/prices/doctor-fees')
      .set(auth(A.tokens.admin))
      .send({ doctorProfileId: doctor, visitType: 'NEW', amountPaise: 50_000 })
      .expect(200);
    expect(await pick('FOLLOW_UP')).toMatchObject({
      currentAmountPaise: 25_000,
      followsBase: false,
    });
    expect(await doctorsList()).toMatchObject({ feeNewPaise: 50_000, feeFollowUpPaise: 25_000 });
  });
});
