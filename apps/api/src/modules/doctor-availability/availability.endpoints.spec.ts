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

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the availability tests`);
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

const RECEPTION_PERMS = ['opd.visits.create', 'opd.visits.read', 'patients.registry.read'] as const;

// 2026-11-23 is a Monday. 04:30Z is 10:00 in Asia/Kolkata, 14:30Z is 20:00.
const MONDAY_10 = new Date('2026-11-23T04:30:00Z');
const MONDAY_20 = new Date('2026-11-23T14:30:00Z');
const at = (date: string, hhmmZ = '04:30') => new Date(`${date}T${hhmmZ}:00Z`);

type Hospital = {
  tenant: string;
  main: string;
  north: string;
  adminToken: string;
  adminMainToken: string;
  adminNorthToken: string;
  recvToken: string;
  nobodyToken: string;
  docMain: string;
  docNorth: string;
  docBoth: string;
};

describe('Doctor availability: switch, timetable and leave (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(MONDAY_10);
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}${stamp}${(seq += 1)}`;
  let A: Hospital;
  let B: Hospital;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const base = (doctor: string) => `/opd/doctors/${doctor}/availability`;

  async function seedHospital(label: string): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `AV_${label}_${stamp}`,
        name: `Availability ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: uniq(`av-${label}-m-`) },
            { code: 'NORTH', name: 'North', accessCode: uniq(`av-${label}-n-`) },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const main = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    const north = hospital.branches.find((b) => b.code === 'NORTH')!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    for (const branchId of [main, north]) {
      await owner.branchModule.create({
        data: { tenantId: tenant, branchId, moduleId: opd.id, enabledByIndigo: true },
      });
    }
    await owner.opdSettings.create({
      data: { tenantId: tenant, followUpFreeDays: 7, tokenPrefix: 'T', timezone: 'Asia/Kolkata' },
    });
    const { superAdminRoleId, branchAdminRoleId } = await ensureSystemRolesForTenant(owner, tenant);

    const person = async (
      key: string,
      branches: string[],
      role?: { roleId?: string; permissions?: readonly string[]; scope: 'HOSPITAL' | 'BRANCH' },
    ) => {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${stamp}${(seq += 1)}`.slice(0, 40),
          email: `${uniq(key)}@example.test`,
          displayName: `Person ${key}`,
          passwordHash: 'x',
        },
      });
      for (const branchId of branches) {
        await owner.userBranch.create({ data: { tenantId: tenant, userId: u.id, branchId } });
      }
      let roleId = role?.roleId;
      if (!roleId && role?.permissions) {
        const perms = await owner.permission.findMany({
          where: { code: { in: [...role.permissions] } },
        });
        const created = await owner.role.create({
          data: { tenantId: tenant, code: uniq(`R_${key}_`), name: key },
        });
        for (const p of perms) {
          await owner.rolePermission.create({
            data: { tenantId: tenant, roleId: created.id, permissionId: p.id },
          });
        }
        roleId = created.id;
      }
      if (roleId && role) {
        const a = await owner.roleAssignment.create({
          data: { tenantId: tenant, userId: u.id, roleId, scopeType: role.scope },
        });
        if (role.scope === 'BRANCH') {
          for (const branchId of branches) {
            await owner.roleAssignmentBranch.create({
              data: { tenantId: tenant, assignmentId: a.id, branchId },
            });
          }
        }
      }
      const token = (branchId: string) =>
        tokenService.signHospitalAccess({ tenantId: tenant, userId: u.id, branchId });
      return { id: u.id, token };
    };

    const admin = await person('sa', [main, north], {
      roleId: superAdminRoleId,
      scope: 'HOSPITAL',
    });
    const adminMain = await person('bamain', [main], {
      roleId: branchAdminRoleId,
      scope: 'BRANCH',
    });
    const adminNorth = await person('banorth', [north], {
      roleId: branchAdminRoleId,
      scope: 'BRANCH',
    });
    const recv = await person('recv', [main], { permissions: RECEPTION_PERMS, scope: 'BRANCH' });
    const nobody = await person('nobody', [main]);
    const doctor = async (key: string, branches: string[]) => {
      const u = await person(key, branches);
      return (
        await owner.doctorProfile.create({
          data: { tenantId: tenant, userId: u.id, code: uniq(`DOC_${key}_`) },
        })
      ).id;
    };
    return {
      tenant,
      main,
      north,
      adminToken: admin.token(main),
      adminMainToken: adminMain.token(main),
      adminNorthToken: adminNorth.token(north),
      recvToken: recv.token(main),
      nobodyToken: nobody.token(main),
      docMain: await doctor('dmain', [main]),
      docNorth: await doctor('dnorth', [north]),
      docBoth: await doctor('dboth', [main, north]),
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

  beforeEach(async () => {
    clock.set(MONDAY_10);
    // every test starts from the same state for the doctors of A
    for (const doctorProfileId of [A.docMain, A.docNorth, A.docBoth]) {
      await owner.doctorLeave.deleteMany({ where: { doctorProfileId } });
      await owner.doctorTiming.deleteMany({ where: { doctorProfileId } });
      await owner.doctorProfile.update({
        where: { id: doctorProfileId },
        data: { availabilityOn: true },
      });
    }
  });

  /** What reception sees when picking a doctor (the real assignment check uses the same rules). */
  async function pick(doctorProfileId: string) {
    const res = await http().get('/opd/doctors').set(auth(A.recvToken)).expect(200);
    return (
      res.body.items as Array<{
        id: string;
        available: boolean;
        unavailableReason: string | null;
        outsideTimings: boolean;
      }>
    ).find((d) => d.id === doctorProfileId);
  }

  const putSwitch = (token: string, doctor: string, availabilityOn: unknown) =>
    http()
      .put(`${base(doctor)}/switch`)
      .set(auth(token))
      .send({ availabilityOn });
  const putTimings = (token: string, doctor: string, branch: string, slots: unknown) =>
    http()
      .put(`${base(doctor)}/timings/${branch}`)
      .set(auth(token))
      .send({ slots });
  const addLeave = (token: string, doctor: string, body: unknown) =>
    http()
      .post(`${base(doctor)}/leave`)
      .set(auth(token))
      .send(body as object);
  const view = (token: string, doctor: string) => http().get(base(doctor)).set(auth(token));

  // ------------------------------------------------------------------ who may use it

  it('needs a token (401) and the doctors permission (403) on every route; reception and nobody are refused', async () => {
    const calls: Array<(token?: string) => request.Test> = [
      (t) => withAuth(http().get(base(A.docMain)), t),
      (t) =>
        withAuth(
          http()
            .put(`${base(A.docMain)}/switch`)
            .send({ availabilityOn: true }),
          t,
        ),
      (t) =>
        withAuth(
          http()
            .put(`${base(A.docMain)}/timings/${A.main}`)
            .send({ slots: [] }),
          t,
        ),
      (t) =>
        withAuth(
          http()
            .post(`${base(A.docMain)}/leave`)
            .send({ fromDate: '2026-12-01', toDate: '2026-12-02' }),
          t,
        ),
      (t) =>
        withAuth(
          http()
            .post(`${base(A.docMain)}/leave/x/remove`)
            .send({}),
          t,
        ),
    ];
    function withAuth(r: request.Test, token?: string): request.Test {
      return token ? r.set(auth(token)) : r;
    }
    for (const call of calls) {
      expect((await call()).status).toBe(401);
      expect((await call(A.recvToken)).status).toBe(403);
      expect((await call(A.nobodyToken)).status).toBe(403);
    }
  });

  it('refuses ids that are not ids with 400', async () => {
    await view(A.adminToken, '..%2Fx').expect(400);
    await putTimings(A.adminToken, A.docMain, 'bad branch!', []).expect(400);
    await http()
      .post(`${base(A.docMain)}/leave/bad%20id/remove`)
      .set(auth(A.adminToken))
      .send({})
      .expect(400);
  });

  // ------------------------------------------------------------------ the new-doctor default

  it('a new doctor is available at once and can be picked (default on)', async () => {
    const u = await owner.user.create({
      data: {
        tenantId: A.tenant,
        code: uniq('NEWDOC'),
        email: `${uniq('newdoc')}@example.test`,
        displayName: 'Brand New Doctor',
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({ data: { tenantId: A.tenant, userId: u.id, branchId: A.main } });
    // exactly what the staff service writes: no availability value at all
    const profile = await owner.doctorProfile.create({
      data: { tenantId: A.tenant, userId: u.id, code: uniq('NEWDOC') },
    });
    expect(profile.availabilityOn).toBe(true);
    const seen = await view(A.adminToken, profile.id).expect(200);
    expect(seen.body).toMatchObject({ availabilityOn: true, timings: [], leaves: [] });
    expect(await pick(profile.id)).toMatchObject({
      available: true,
      unavailableReason: null,
      outsideTimings: false,
    });
  });

  // ------------------------------------------------------------------ the switch

  it('the switch blocks assignment when off and allows it when on again, with an audit row', async () => {
    const res = await putSwitch(A.adminToken, A.docMain, false).expect(200);
    expect(res.body.availabilityOn).toBe(false);
    expect(await pick(A.docMain)).toMatchObject({
      available: false,
      unavailableReason: 'SWITCH_OFF',
    });
    await putSwitch(A.adminToken, A.docMain, true).expect(200);
    expect(await pick(A.docMain)).toMatchObject({ available: true, unavailableReason: null });
    const rows = await owner.auditLog.findMany({
      where: {
        tenantId: A.tenant,
        action: 'DOCTOR_AVAILABILITY_CHANGE',
        entityId: A.docMain,
      },
      orderBy: { createdAt: 'asc' },
    });
    const switches = rows.filter((r) => (r.metadata as { kind?: string }).kind === 'SWITCH');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    expect(switches.at(-1)!.metadata).toEqual({ kind: 'SWITCH', availabilityOn: true });
  });

  it('the switch must be a real true or false', async () => {
    for (const bad of ['true', 'false', 1, 0, null, undefined]) {
      const res = await putSwitch(A.adminToken, A.docMain, bad).expect(400);
      expect(res.body.code).toBe('AVAILABILITY_INVALID');
    }
    await http()
      .put(`${base(A.docMain)}/switch`)
      .set(auth(A.adminToken))
      .send({ availabilityOn: true, extra: 1 })
      .expect(400);
  });

  // ------------------------------------------------------------------ timings

  it('the weekly timetable is saved per branch, read back as HH:MM, replaced as a whole and cleared by an empty list', async () => {
    const slots = [
      { weekday: 1, start: '09:00', end: '13:00' },
      { weekday: 1, start: '13:00', end: '17:00' }, // touching is fine
      { weekday: 3, start: '10:00', end: '12:30' },
    ];
    const res = await putTimings(A.adminToken, A.docBoth, A.main, slots).expect(200);
    expect(
      res.body.timings.map(
        (t: { weekday: number; start: string; end: string; branchId: string }) => [
          t.branchId,
          t.weekday,
          t.start,
          t.end,
        ],
      ),
    ).toEqual([
      [A.main, 1, '09:00', '13:00'],
      [A.main, 1, '13:00', '17:00'],
      [A.main, 3, '10:00', '12:30'],
    ]);
    // the other branch is untouched
    await putTimings(A.adminToken, A.docBoth, A.north, [
      { weekday: 2, start: '08:00', end: '09:00' },
    ]).expect(200);
    // a new list replaces the old one in that branch only
    const replaced = await putTimings(A.adminToken, A.docBoth, A.main, [
      { weekday: 5, start: '14:00', end: '16:00' },
    ]).expect(200);
    expect(replaced.body.timings).toHaveLength(2);
    expect(
      await owner.doctorTiming.count({ where: { doctorProfileId: A.docBoth, branchId: A.main } }),
    ).toBe(1);
    await putTimings(A.adminToken, A.docBoth, A.main, []).expect(200);
    expect(
      await owner.doctorTiming.count({ where: { doctorProfileId: A.docBoth, branchId: A.main } }),
    ).toBe(0);
    expect(
      await owner.doctorTiming.count({ where: { doctorProfileId: A.docBoth, branchId: A.north } }),
    ).toBe(1);
  });

  it('refuses overlaps, an end that is not after the start, bad times, weekdays and shapes', async () => {
    const reason = async (slots: unknown) => {
      const res = await putTimings(A.adminToken, A.docMain, A.main, slots).expect(400);
      expect(res.body.code).toBe('AVAILABILITY_INVALID');
      return res.body.reason as string;
    };
    expect(
      await reason([
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '11:59', end: '15:00' },
      ]),
    ).toBe('OVERLAP');
    expect(await reason([{ weekday: 1, start: '12:00', end: '12:00' }])).toBe('END_BEFORE_START');
    expect(await reason([{ weekday: 1, start: '12:00', end: '09:00' }])).toBe('END_BEFORE_START');
    expect(await reason([{ weekday: 1, start: '24:00', end: '23:00' }])).toBe('TIME_INVALID');
    expect(await reason([{ weekday: 1, start: '9:00', end: '10:00' }])).toBe('TIME_INVALID');
    expect(await reason([{ weekday: 1, start: '09:00', end: '10:60' }])).toBe('TIME_INVALID');
    expect(await reason([{ weekday: 7, start: '09:00', end: '10:00' }])).toBe('WEEKDAY_INVALID');
    expect(await reason([{ weekday: 1.5, start: '09:00', end: '10:00' }])).toBe('WEEKDAY_INVALID');
    expect(await reason([{ weekday: '1', start: '09:00', end: '10:00' }])).toBe('WEEKDAY_INVALID');
    expect(await reason('not a list')).toBe('REQUIRED');
    expect(await reason([{ weekday: 1, start: '09:00', end: '10:00', note: 'x' }])).toBe(
      'UNKNOWN_FIELD',
    );
    expect(
      await reason(
        [0, 1, 2, 3, 4].map((h) => ({ weekday: 2, start: `0${h}:00`, end: `0${h}:30` })),
      ),
    ).toBe('TOO_MANY_PER_DAY');
    // nothing was saved by any refused request
    expect(await owner.doctorTiming.count({ where: { doctorProfileId: A.docMain } })).toBe(0);
  });

  it('timings only WARN: outside the timetable the doctor can still be picked', async () => {
    await putTimings(A.adminToken, A.docMain, A.main, [
      { weekday: 1, start: '09:00', end: '13:00' },
    ]).expect(200);
    clock.set(MONDAY_10);
    expect(await pick(A.docMain)).toMatchObject({ available: true, outsideTimings: false });
    clock.set(MONDAY_20);
    expect(await pick(A.docMain)).toMatchObject({
      available: true,
      unavailableReason: null,
      outsideTimings: true,
    });
    // no timetable at all is no warning
    await putTimings(A.adminToken, A.docMain, A.main, []).expect(200);
    expect(await pick(A.docMain)).toMatchObject({ available: true, outsideTimings: false });
  });

  it('a timetable of a branch the doctor does not work in, or of another hospital, is refused', async () => {
    for (const branch of [A.north, B.main, 'does-not-exist']) {
      const res = await putTimings(A.adminToken, A.docMain, branch, [
        { weekday: 1, start: '09:00', end: '10:00' },
      ]).expect(400);
      expect(res.body).toMatchObject({ field: 'branchId', reason: 'BRANCH_NOT_ALLOWED' });
    }
    expect(await owner.doctorTiming.count({ where: { doctorProfileId: A.docMain } })).toBe(0);
  });

  // ------------------------------------------------------------------ leave

  it('leave blocks assignment on its days only, and removing it allows assignment again', async () => {
    const res = await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-11-24',
      toDate: '2026-11-25',
    }).expect(200);
    expect(res.body.leaves).toEqual([
      expect.objectContaining({ fromDate: '2026-11-24', toDate: '2026-11-25' }),
    ]);
    const leaveId = res.body.leaves[0].id as string;

    clock.set(at('2026-11-23'));
    expect(await pick(A.docMain)).toMatchObject({ available: true });
    clock.set(at('2026-11-24'));
    expect(await pick(A.docMain)).toMatchObject({
      available: false,
      unavailableReason: 'ON_LEAVE',
    });
    clock.set(at('2026-11-25', '18:00')); // the last day counts, even late in the day
    expect(await pick(A.docMain)).toMatchObject({
      available: false,
      unavailableReason: 'ON_LEAVE',
    });
    clock.set(at('2026-11-26'));
    expect(await pick(A.docMain)).toMatchObject({ available: true });

    clock.set(MONDAY_10);
    const removed = await http()
      .post(`${base(A.docMain)}/leave/${leaveId}/remove`)
      .set(auth(A.adminToken))
      .send({})
      .expect(200);
    expect(removed.body.leaves).toEqual([]);
    clock.set(at('2026-11-24'));
    expect(await pick(A.docMain)).toMatchObject({ available: true, unavailableReason: null });
  });

  it('another doctor is not affected by this leave', async () => {
    await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-11-23',
      toDate: '2026-11-23',
    }).expect(200);
    expect(await pick(A.docMain)).toMatchObject({ available: false });
    expect(await pick(A.docBoth)).toMatchObject({ available: true });
  });

  it('refuses a leave that ends before it starts, is in the past, too long, too far ahead, not a date, or overlaps', async () => {
    const reason = async (body: unknown) => {
      const res = await addLeave(A.adminToken, A.docMain, body).expect(400);
      expect(res.body.code).toBe('AVAILABILITY_INVALID');
      return res.body.reason as string;
    };
    expect(await reason({ fromDate: '2026-12-05', toDate: '2026-12-04' })).toBe('END_BEFORE_START');
    expect(await reason({ fromDate: '2026-11-01', toDate: '2026-11-10' })).toBe('DATE_IN_PAST');
    expect(await reason({ fromDate: '2026-12-01', toDate: '2028-01-01' })).toBe('TOO_LONG');
    expect(await reason({ fromDate: '2030-01-01', toDate: '2030-01-02' })).toBe('TOO_FAR');
    expect(await reason({ fromDate: '2026-02-30', toDate: '2026-12-02' })).toBe('DATE_INVALID');
    expect(await reason({ fromDate: '2026/12/01', toDate: '2026-12-02' })).toBe('DATE_INVALID');
    expect(await reason({ fromDate: '2026-12-01' })).toBe('DATE_INVALID');
    expect(await reason({ fromDate: '2026-12-01', toDate: '2026-12-02', reason: 'holiday' })).toBe(
      'UNKNOWN_FIELD',
    );
    await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-12-10',
      toDate: '2026-12-12',
    }).expect(200);
    expect(await reason({ fromDate: '2026-12-12', toDate: '2026-12-14' })).toBe('LEAVE_OVERLAP');
    expect(await reason({ fromDate: '2026-12-01', toDate: '2026-12-10' })).toBe('LEAVE_OVERLAP');
    // the next day after the last day is free
    await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-12-13',
      toDate: '2026-12-13',
    }).expect(200);
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMain } })).toBe(2);
  });

  it('removing a leave twice, or one that does not exist, or one of another doctor, is 404', async () => {
    const mine = await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-12-20',
      toDate: '2026-12-21',
    }).expect(200);
    const id = mine.body.leaves[0].id as string;
    const other = await addLeave(A.adminToken, A.docBoth, {
      fromDate: '2026-12-20',
      toDate: '2026-12-21',
    }).expect(200);
    const otherId = other.body.leaves[0].id as string;
    const remove = (doctor: string, leaveId: string) =>
      http()
        .post(`${base(doctor)}/leave/${leaveId}/remove`)
        .set(auth(A.adminToken))
        .send({});
    expect((await remove(A.docMain, otherId)).status).toBe(404); // another doctor's leave
    expect((await remove(A.docMain, id)).status).toBe(200);
    const replay = await remove(A.docMain, id);
    expect(replay.status).toBe(404);
    expect(replay.body.code).toBe('AVAILABILITY_LEAVE_NOT_FOUND');
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docBoth } })).toBe(1);
  });

  // ------------------------------------------------------------------ who may reach whom

  it('a Branch Admin reaches only doctors of their own branch and only their branch timetable', async () => {
    // the hospital-wide Admin sets a timetable in both branches of the doctor of both
    await putTimings(A.adminToken, A.docBoth, A.main, [
      { weekday: 1, start: '09:00', end: '10:00' },
    ]).expect(200);
    await putTimings(A.adminToken, A.docBoth, A.north, [
      { weekday: 2, start: '11:00', end: '12:00' },
    ]).expect(200);

    // Branch Admin of Main: sees Main doctors only
    await view(A.adminMainToken, A.docMain).expect(200);
    await view(A.adminMainToken, A.docNorth).expect(404);
    const both = await view(A.adminMainToken, A.docBoth).expect(200);
    expect(both.body.branches).toEqual([{ id: A.main, name: 'Main', editable: true }]);
    expect(both.body.timings.map((t: { branchId: string }) => t.branchId)).toEqual([A.main]);

    // changes: own-branch doctor yes, other branch doctor 404
    await putSwitch(A.adminMainToken, A.docMain, false).expect(200);
    await putSwitch(A.adminMainToken, A.docNorth, false).expect(404);
    expect(
      (await owner.doctorProfile.findUniqueOrThrow({ where: { id: A.docNorth } })).availabilityOn,
    ).toBe(true);
    await addLeave(A.adminMainToken, A.docNorth, {
      fromDate: '2026-12-01',
      toDate: '2026-12-02',
    }).expect(404);
    await putTimings(A.adminMainToken, A.docNorth, A.north, []).expect(404);

    // the shared doctor: own branch timetable yes, the other branch timetable refused
    await putTimings(A.adminMainToken, A.docBoth, A.main, [
      { weekday: 4, start: '08:00', end: '09:00' },
    ]).expect(200);
    const refused = await putTimings(A.adminMainToken, A.docBoth, A.north, []).expect(400);
    expect(refused.body.reason).toBe('BRANCH_NOT_ALLOWED');
    expect(
      await owner.doctorTiming.count({ where: { doctorProfileId: A.docBoth, branchId: A.north } }),
    ).toBe(1);

    // Branch Admin of North mirrors this
    await view(A.adminNorthToken, A.docMain).expect(404);
    const northView = await view(A.adminNorthToken, A.docBoth).expect(200);
    expect(northView.body.branches).toEqual([{ id: A.north, name: 'North', editable: true }]);
    expect(northView.body.timings.map((t: { branchId: string }) => t.branchId)).toEqual([A.north]);

    // the hospital-wide Admin sees both branches
    const all = await view(A.adminToken, A.docBoth).expect(200);
    expect(all.body.branches.map((b: { id: string }) => b.id).sort()).toEqual(
      [A.main, A.north].sort(),
    );
  });

  it('leave and the switch belong to the doctor, so a Branch Admin of one branch affects a shared doctor everywhere (decided, recorded)', async () => {
    const added = await addLeave(A.adminMainToken, A.docBoth, {
      fromDate: '2026-11-23',
      toDate: '2026-11-23',
    }).expect(200);
    // the doctor is blocked in the other branch too, and the other Branch Admin sees the leave
    expect((await view(A.adminNorthToken, A.docBoth).expect(200)).body.leaves).toHaveLength(1);
    expect(await pick(A.docBoth)).toMatchObject({
      available: false,
      unavailableReason: 'ON_LEAVE',
    });
    await http()
      .post(`${base(A.docBoth)}/leave/${added.body.leaves[0].id}/remove`)
      .set(auth(A.adminNorthToken))
      .send({})
      .expect(200);
    expect(await pick(A.docBoth)).toMatchObject({ available: true });
  });

  it('another hospital can neither see nor change a doctor, a leave or a branch of this one', async () => {
    const leave = await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-12-01',
      toDate: '2026-12-02',
    }).expect(200);
    const leaveId = leave.body.leaves[0].id as string;
    await view(B.adminToken, A.docMain).expect(404);
    await putSwitch(B.adminToken, A.docMain, false).expect(404);
    await putTimings(B.adminToken, A.docMain, B.main, []).expect(404);
    await addLeave(B.adminToken, A.docMain, {
      fromDate: '2026-12-05',
      toDate: '2026-12-06',
    }).expect(404);
    await http()
      .post(`${base(A.docMain)}/leave/${leaveId}/remove`)
      .set(auth(B.adminToken))
      .send({})
      .expect(404);
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMain } })).toBe(1);
    expect(
      (await owner.doctorProfile.findUniqueOrThrow({ where: { id: A.docMain } })).availabilityOn,
    ).toBe(true);
    // and the other way: a doctor of B is invisible to A
    await view(A.adminToken, B.docMain).expect(404);
  });

  // ------------------------------------------------------------------ audit, grants, concurrency

  it('the audit trail keeps ids, dates and times only', async () => {
    const startedAt = new Date(Date.now() - 1000);
    await putTimings(A.adminToken, A.docMain, A.main, [
      { weekday: 1, start: '09:00', end: '12:00' },
    ]).expect(200);
    const added = await addLeave(A.adminToken, A.docMain, {
      fromDate: '2026-12-01',
      toDate: '2026-12-03',
    }).expect(200);
    const leaveId = added.body.leaves[0].id as string;
    await http()
      .post(`${base(A.docMain)}/leave/${leaveId}/remove`)
      .set(auth(A.adminToken))
      .send({})
      .expect(200);
    const rows = await owner.auditLog.findMany({
      where: {
        tenantId: A.tenant,
        action: 'DOCTOR_AVAILABILITY_CHANGE',
        entityId: A.docMain,
        createdAt: { gte: startedAt },
      },
      orderBy: { createdAt: 'desc' },
    });
    const byKind = (kind: string) =>
      rows.find((r) => (r.metadata as { kind: string }).kind === kind)!.metadata;
    expect(byKind('TIMINGS')).toEqual({
      kind: 'TIMINGS',
      branchId: A.main,
      slots: [[1, '09:00', '12:00']],
    });
    expect(byKind('LEAVE_ADD')).toEqual({
      kind: 'LEAVE_ADD',
      leaveId,
      fromDate: '2026-12-01',
      toDate: '2026-12-03',
    });
    expect(byKind('LEAVE_REMOVE')).toEqual({
      kind: 'LEAVE_REMOVE',
      leaveId,
      fromDate: '2026-12-01',
      toDate: '2026-12-03',
    });
    expect(new Set(rows.map((r) => r.reason))).toEqual(
      new Set(['Admin changed doctor availability']),
    );
    expect(rows.every((r) => r.actorUserId !== null)).toBe(true);
  });

  it('the application login may delete only doctor timings and leave (the migration grants nothing else)', async () => {
    const priv = async (table: string) =>
      (
        await owner.$queryRawUnsafe<Array<{ ok: boolean }>>(
          `SELECT has_table_privilege('hospigo_app', 'public.${table}', 'DELETE') AS ok`,
        )
      )[0]!.ok;
    expect(await priv('doctor_timings')).toBe(true);
    expect(await priv('doctor_leave')).toBe(true);
    const stillClosed: string[] = [];
    for (const table of [
      'doctor_profiles',
      'doctor_fees',
      'charge_item_prices',
      'audit_logs',
      'opd_visits',
      'bills',
    ]) {
      if (await priv(table)) {
        stillClosed.push(table);
      }
    }
    expect(stillClosed).toEqual([]);
  });

  it('two leave periods for the same days added at the same moment save once', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        addLeave(A.adminToken, A.docMain, { fromDate: '2026-12-15', toDate: '2026-12-16' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMain } })).toBe(1);
  });

  it('two timetables saved at the same moment leave exactly one complete timetable', async () => {
    const one = [{ weekday: 1, start: '09:00', end: '10:00' }];
    const two = [
      { weekday: 2, start: '09:00', end: '10:00' },
      { weekday: 3, start: '09:00', end: '10:00' },
    ];
    const results = await Promise.all([
      putTimings(A.adminToken, A.docMain, A.main, one),
      putTimings(A.adminToken, A.docMain, A.main, two),
      putTimings(A.adminToken, A.docMain, A.main, one),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const rows = await owner.doctorTiming.findMany({ where: { doctorProfileId: A.docMain } });
    expect([1, 2]).toContain(rows.length);
    expect(new Set(rows.map((r) => r.weekday)).size).toBe(rows.length); // no mixture, no duplicates
  });
});
