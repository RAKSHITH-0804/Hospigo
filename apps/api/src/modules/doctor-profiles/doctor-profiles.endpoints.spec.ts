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
    throw new Error(`${envKey} is required for the doctor profile tests`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

type Hospital = {
  tenant: string;
  main: string;
  east: string;
  tokens: Record<string, string>;
  users: Record<string, string>;
  docs: Record<string, string>;
};

const OWN = ['opd.doctors.own'] as const;
const READ = ['opd.doctors.read'] as const;
const WRITE = ['opd.doctors.read', 'opd.doctors.write'] as const;
const WRITE_ONLY = ['opd.doctors.write'] as const;
const ALL_CODES = [...new Set([...OWN, ...READ, ...WRITE])];

describe('doctor profiles (HTTP)', () => {
  jest.setTimeout(120_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
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
        code: `DP_${label}_${stamp}`,
        name: `Doctors ${label}`,
        isTest: true,
        branches: {
          create: [
            {
              code: 'MAIN',
              name: 'Main Branch',
              isMain: true,
              accessCode: `dp-${label}-m-${stamp}`,
            },
            {
              code: 'EAST',
              name: 'East Branch',
              isMain: false,
              accessCode: `dp-${label}-e-${stamp}`,
            },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const main = hospital.branches.find((b) => b.isMain)!.id;
    const east = hospital.branches.find((b) => !b.isMain)!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    for (const branchId of [main, east]) {
      await owner.branchModule.create({
        data: { tenantId: tenant, branchId, moduleId: opd.id, enabledByIndigo: true },
      });
    }
    const perms = await owner.permission.findMany({ where: { code: { in: ALL_CODES } } });
    if (perms.length !== ALL_CODES.length) {
      throw new Error('Doctor permissions missing from the test catalog');
    }
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    const docs: Record<string, string> = {};

    async function makeUser(
      key: string,
      codes: readonly string[],
      branches: string[],
      opts: { hospitalScope?: boolean; displayName?: string } = {},
    ) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `dp_${key}_${label}_${stamp}@example.test`,
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
    async function makeDoctor(
      key: string,
      branches: string[],
      over: { active?: boolean; codes?: readonly string[] } = {},
    ) {
      const u = await makeUser(key, over.codes ?? OWN, branches, { displayName: `Login ${key}` });
      const profile = await owner.doctorProfile.create({
        data: {
          tenantId: tenant,
          userId: u.id,
          code: `D_${key}_${label}_${stamp}`.slice(0, 40),
          department: 'General',
          active: over.active ?? true,
        },
      });
      docs[key] = profile.id;
    }

    await makeUser('superAdmin', WRITE, [main], { hospitalScope: true });
    await makeUser('adminMain', WRITE, [main]);
    await makeUser('adminEast', WRITE, [east]);
    await makeUser('reader', READ, [main]);
    await makeUser('writeOnly', WRITE_ONLY, [main]);
    await makeUser('nobody', [], [main]);
    await makeUser('noProfile', OWN, [main]);
    await makeDoctor('docMain', [main]);
    await makeDoctor('docEast', [east]);
    await makeDoctor('docBoth', [main, east]);
    await makeDoctor('docOff', [main], { active: false });
    return { tenant, main, east, tokens, users, docs };
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

  const http = () => request(app.getHttpServer());
  const call = (method: 'get' | 'put', h: Hospital, who: string, url: string, body?: unknown) =>
    (http() as Loose)
      [method](url)
      .set({ Authorization: `Bearer ${h.tokens[who]}` })
      .send(body ?? {});
  const get = (h: Hospital, who: string, url: string) => call('get', h, who, url);
  const put = (h: Hospital, who: string, url: string, body?: unknown) =>
    call('put', h, who, url, body);
  const row = (id: string) => owner.doctorProfile.findUniqueOrThrow({ where: { id } });
  const audits = (h: Hospital) =>
    owner.auditLog.findMany({
      where: { tenantId: h.tenant, action: 'DOCTOR_PROFILE_CHANGE' },
      orderBy: { createdAt: 'asc' },
    });
  const invalid = (res: Loose, field: string, reason?: string) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SETTINGS_INVALID');
    expect(res.body.field).toBe(field);
    if (reason) expect(res.body.reason).toBe(reason);
  };
  const names = (res: Loose): string[] => res.body.items.map((d: Loose) => d.code.split('_')[1]);

  describe('access', () => {
    const ROUTES: Array<['get' | 'put', string]> = [
      ['get', '/doctor-profiles/me'],
      ['put', '/doctor-profiles/me'],
      ['get', '/doctor-profiles'],
      ['put', '/doctor-profiles/some-id'],
    ];

    it('401 without a token or with a patient token, on every route', async () => {
      const patientToken = tokenService.signPatientAccess({ accountId: 'acc' });
      for (const [method, url] of ROUTES) {
        expect((await (http() as Loose)[method](url).send({})).status).toBe(401);
        expect(
          (
            await (http() as Loose)
              [method](url)
              .set({ Authorization: `Bearer ${patientToken}` })
              .send({})
          ).status,
        ).toBe(401);
      }
    });

    it('a doctor (own permission only) cannot list doctors or correct another doctor', async () => {
      expect((await get(A, 'docMain', '/doctor-profiles')).status).toBe(403);
      expect(
        (await put(A, 'docMain', `/doctor-profiles/${A.docs.docBoth}`, { qualifications: 'X' }))
          .status,
      ).toBe(403);
      expect((await row(A.docs.docBoth)).qualifications).toBeNull();
    });

    it('an Admin without the own permission has no "my profile"; reception-like users have nothing', async () => {
      for (const who of ['superAdmin', 'adminMain', 'reader', 'nobody']) {
        expect({ who, status: (await get(A, who, '/doctor-profiles/me')).status }).toEqual({
          who,
          status: 403,
        });
        expect((await put(A, who, '/doctor-profiles/me', { speciality: 'X' })).status).toBe(403);
      }
      expect((await get(A, 'nobody', '/doctor-profiles')).status).toBe(403);
      expect(
        (await put(A, 'nobody', `/doctor-profiles/${A.docs.docMain}`, { speciality: 'X' })).status,
      ).toBe(403);
    });

    it('reading and correcting are separate permissions', async () => {
      expect((await get(A, 'reader', '/doctor-profiles')).status).toBe(200);
      expect(
        (await put(A, 'reader', `/doctor-profiles/${A.docs.docMain}`, { speciality: 'X' })).status,
      ).toBe(403);
      // write without read can correct but not list
      expect((await get(A, 'writeOnly', '/doctor-profiles')).status).toBe(403);
      expect(
        (await put(A, 'writeOnly', `/doctor-profiles/${A.docs.docMain}`, { speciality: 'Gastro' }))
          .status,
      ).toBe(200);
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { speciality: null },
      });
    });
  });

  describe('my profile', () => {
    it('a doctor reads their own profile, found from the token, with what is still missing', async () => {
      const res = await get(A, 'docMain', '/doctor-profiles/me');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: A.docs.docMain,
        name: 'Login docMain',
        printedName: null,
        printName: 'Login docMain',
        department: 'General',
        qualifications: null,
        speciality: null,
        registrationNo: null,
        active: true,
        branches: ['Main Branch'],
        missing: ['qualifications', 'speciality', 'registrationNo'],
      });
      expect((await get(A, 'docBoth', '/doctor-profiles/me')).body.branches).toEqual([
        'East Branch',
        'Main Branch',
      ]);
    });

    it('saves some or all fields, keeps the rest, trims and tidies spaces, and an empty text clears', async () => {
      const first = await put(A, 'docMain', '/doctor-profiles/me', {
        printedName: '  Dr.   A.  Rao ',
        qualifications: 'MBBS,  MD (Medicine)',
      });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        printedName: 'Dr. A. Rao',
        printName: 'Dr. A. Rao',
        qualifications: 'MBBS, MD (Medicine)',
        speciality: null,
        missing: ['speciality', 'registrationNo'],
      });
      const second = await put(A, 'docMain', '/doctor-profiles/me', {
        speciality: 'General Medicine',
        registrationNo: 'KMC/12345 (2019)',
      });
      expect(second.body).toMatchObject({
        printedName: 'Dr. A. Rao',
        speciality: 'General Medicine',
        registrationNo: 'KMC/12345 (2019)',
        missing: [],
      });
      const cleared = await put(A, 'docMain', '/doctor-profiles/me', {
        printedName: '   ',
        speciality: null,
      });
      expect(cleared.body).toMatchObject({
        printedName: null,
        printName: 'Login docMain',
        speciality: null,
        qualifications: 'MBBS, MD (Medicine)',
      });
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { printedName: null, qualifications: null, speciality: null, registrationNo: null },
      });
    });

    it('refuses bad values with the field and the reason, and saves nothing', async () => {
      const before = await row(A.docs.docMain);
      const post = (body: unknown) => put(A, 'docMain', '/doctor-profiles/me', body);
      invalid(await post([]), 'body', 'REQUIRED');
      invalid(await post({}), 'body', 'REQUIRED');
      invalid(await post({ unknown: 'x' }), 'body', 'REQUIRED');
      invalid(await post({ printedName: 'x'.repeat(81) }), 'printedName', 'TOO_LONG');
      invalid(await post({ qualifications: 'x'.repeat(151) }), 'qualifications', 'TOO_LONG');
      invalid(await post({ speciality: 'x'.repeat(81) }), 'speciality', 'TOO_LONG');
      invalid(await post({ registrationNo: 'x'.repeat(41) }), 'registrationNo', 'TOO_LONG');
      for (const bad of [5, true, {}, ['a']]) {
        invalid(await post({ speciality: bad }), 'speciality', 'INVALID');
      }
      invalid(await post({ speciality: 'a\nb' }), 'speciality', 'INVALID');
      invalid(await post({ speciality: 'a\u0000b' }), 'speciality', 'INVALID');
      for (const text of [
        "12'; DROP TABLE doctor_profiles;--",
        '<b>1</b>',
        'REG\\1',
        'ü123',
        '12*34',
      ]) {
        invalid(await post({ registrationNo: text }), 'registrationNo', 'INVALID');
      }
      // none of the refusals saved anything
      expect(await row(A.docs.docMain)).toEqual(before);
      // the longest allowed values are fine
      const edge = await post({
        printedName: 'p'.repeat(80),
        qualifications: 'q'.repeat(150),
        speciality: 's'.repeat(80),
        registrationNo: 'r'.repeat(40),
      });
      expect(edge.status).toBe(200);
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { printedName: null, qualifications: null, speciality: null, registrationNo: null },
      });
    });

    it('a doctor cannot change the department (only an Admin can)', async () => {
      invalid(
        await put(A, 'docMain', '/doctor-profiles/me', { department: 'Surgery' }),
        'department',
        'NOT_ALLOWED',
      );
      invalid(
        await put(A, 'docMain', '/doctor-profiles/me', { department: 'Surgery', speciality: 'x' }),
        'department',
        'NOT_ALLOWED',
      );
      const profile = await row(A.docs.docMain);
      expect(profile.department).toBe('General');
      expect(profile.speciality).toBeNull();
    });

    it('the body cannot pick another doctor, hospital, user or code', async () => {
      const res = await put(A, 'docMain', '/doctor-profiles/me', {
        speciality: 'Mine',
        id: A.docs.docEast,
        userId: A.users.docEast,
        tenantId: B.tenant,
        code: 'HACK',
        active: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(A.docs.docMain);
      expect((await row(A.docs.docEast)).speciality).toBeNull();
      const mine = await row(A.docs.docMain);
      expect(mine.speciality).toBe('Mine');
      expect(mine.active).toBe(true);
      expect(mine.code).not.toBe('HACK');
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { speciality: null },
      });
    });

    it('someone with the permission but no doctor profile, or an inactive one, gets 403 DOCTOR_PROFILE_REQUIRED', async () => {
      for (const who of ['noProfile', 'docOff']) {
        const read = await get(A, who, '/doctor-profiles/me');
        expect({ who, status: read.status, code: read.body.code }).toEqual({
          who,
          status: 403,
          code: 'DOCTOR_PROFILE_REQUIRED',
        });
        expect((await put(A, who, '/doctor-profiles/me', { speciality: 'x' })).status).toBe(403);
      }
      expect((await row(A.docs.docOff)).speciality).toBeNull();
    });

    it('two doctors of one hospital never see each other, and another hospital is apart', async () => {
      await put(A, 'docEast', '/doctor-profiles/me', { speciality: 'East only' });
      expect((await get(A, 'docMain', '/doctor-profiles/me')).body.speciality).toBeNull();
      expect((await get(B, 'docMain', '/doctor-profiles/me')).body.speciality).toBeNull();
      await owner.doctorProfile.update({
        where: { id: A.docs.docEast },
        data: { speciality: null },
      });
    });
  });

  describe('the Admin list and corrections', () => {
    it('a hospital-wide Admin sees every doctor of the hospital and no other hospital', async () => {
      const res = await get(A, 'superAdmin', '/doctor-profiles');
      expect(res.status).toBe(200);
      expect(names(res).sort()).toEqual(['docBoth', 'docEast', 'docMain', 'docOff']);
      expect(res.body.canWrite).toBe(true);
      expect(res.body.limits).toEqual({
        printedName: 80,
        qualifications: 150,
        speciality: 80,
        registrationNo: 40,
        department: 100,
      });
      const other = await get(B, 'superAdmin', '/doctor-profiles');
      expect(names(other).sort()).toEqual(['docBoth', 'docEast', 'docMain', 'docOff']);
      const mine = new Set(res.body.items.map((d: Loose) => d.id));
      for (const d of other.body.items) expect(mine.has(d.id)).toBe(false);
    });

    it('a Branch Admin sees only doctors who work in their own branch', async () => {
      expect(names(await get(A, 'adminMain', '/doctor-profiles')).sort()).toEqual([
        'docBoth',
        'docMain',
        'docOff',
      ]);
      expect(names(await get(A, 'adminEast', '/doctor-profiles')).sort()).toEqual([
        'docBoth',
        'docEast',
      ]);
    });

    it('a reader sees the list but is told they cannot write', async () => {
      const res = await get(A, 'reader', '/doctor-profiles');
      expect(res.status).toBe(200);
      expect(res.body.canWrite).toBe(false);
    });

    it('a hospital-wide Admin corrects any doctor, including the department, and can clear it', async () => {
      const res = await put(A, 'superAdmin', `/doctor-profiles/${A.docs.docEast}`, {
        department: 'Cardiology',
        printedName: 'Dr. East',
        registrationNo: 'E/1',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        department: 'Cardiology',
        printName: 'Dr. East',
        registrationNo: 'E/1',
      });
      const cleared = await put(A, 'superAdmin', `/doctor-profiles/${A.docs.docEast}`, {
        department: null,
      });
      expect(cleared.body.department).toBeNull();
      await owner.doctorProfile.update({
        where: { id: A.docs.docEast },
        data: { department: 'General', printedName: null, registrationNo: null },
      });
    });

    it('a Branch Admin corrects doctors of their own branch only; others are 404 and untouched', async () => {
      expect(
        (
          await put(A, 'adminMain', `/doctor-profiles/${A.docs.docMain}`, {
            qualifications: 'MBBS',
          })
        ).status,
      ).toBe(200);
      expect(
        (await put(A, 'adminMain', `/doctor-profiles/${A.docs.docBoth}`, { speciality: 'Shared' }))
          .status,
      ).toBe(200);
      const outside = await put(A, 'adminMain', `/doctor-profiles/${A.docs.docEast}`, {
        qualifications: 'HACKED',
      });
      expect(outside.status).toBe(404);
      expect(outside.body.code).toBe('SETTINGS_NOT_FOUND');
      expect((await row(A.docs.docEast)).qualifications).toBeNull();
      expect(
        (
          await put(A, 'adminEast', `/doctor-profiles/${A.docs.docMain}`, {
            qualifications: 'HACKED',
          })
        ).status,
      ).toBe(404);
      expect((await row(A.docs.docMain)).qualifications).toBe('MBBS');
      await owner.doctorProfile.updateMany({
        where: { id: { in: [A.docs.docMain, A.docs.docBoth] } },
        data: { qualifications: null, speciality: null },
      });
    });

    it('a doctor of another hospital, an unknown id and a junk id are all 404', async () => {
      for (const id of [B.docs.docMain, 'nope', '..%2F..', 'x'.repeat(200)]) {
        const res = await put(A, 'superAdmin', `/doctor-profiles/${id}`, { qualifications: 'X' });
        expect({ id, status: res.status }).toEqual({ id, status: 404 });
      }
      expect((await row(B.docs.docMain)).qualifications).toBeNull();
    });

    it('the Admin corrections are checked like a doctor own (limits, characters, empty body, department length)', async () => {
      const url = `/doctor-profiles/${A.docs.docMain}`;
      const post = (body: unknown) => put(A, 'superAdmin', url, body);
      invalid(await post({}), 'body', 'REQUIRED');
      invalid(await post({ registrationNo: '<script>' }), 'registrationNo', 'INVALID');
      invalid(await post({ department: 'd'.repeat(101) }), 'department', 'TOO_LONG');
      invalid(await post({ department: 5 }), 'department', 'INVALID');
      invalid(await post({ qualifications: 'q'.repeat(151) }), 'qualifications', 'TOO_LONG');
      expect((await row(A.docs.docMain)).department).toBe('General');
    });

    it('does not let the body move a doctor to another hospital or change the login', async () => {
      const res = await put(A, 'superAdmin', `/doctor-profiles/${A.docs.docMain}`, {
        speciality: 'Fine',
        tenantId: B.tenant,
        userId: A.users.docEast,
        code: 'HACK',
      });
      expect(res.status).toBe(200);
      const profile = await row(A.docs.docMain);
      expect(profile.tenantId).toBe(A.tenant);
      expect(profile.userId).toBe(A.users.docMain);
      expect(profile.code).not.toBe('HACK');
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { speciality: null },
      });
    });
  });

  describe('audit', () => {
    it('every change is recorded with who and which fields, never the text typed', async () => {
      const before = (await audits(A)).length;
      await put(A, 'docMain', '/doctor-profiles/me', {
        qualifications: 'Secret Qualification XYZ',
        registrationNo: 'SECRET-REG-777',
      });
      await put(A, 'superAdmin', `/doctor-profiles/${A.docs.docMain}`, {
        department: 'Secret Dept',
      });
      const rows = (await audits(A)).slice(before);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        actorUserId: A.users.docMain,
        entityType: 'doctor_profiles',
        entityId: A.docs.docMain,
        metadata: { changed: ['qualifications', 'registrationNo'], self: true },
      });
      expect(rows[1]).toMatchObject({
        actorUserId: A.users.superAdmin,
        entityId: A.docs.docMain,
        metadata: { changed: ['department'], self: false },
      });
      const text = JSON.stringify(rows.map((r) => [r.metadata, r.reason]));
      expect(text).not.toMatch(/Secret|SECRET/);
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { qualifications: null, registrationNo: null, department: 'General' },
      });
    });

    it('a refused change leaves no trail', async () => {
      const before = (await audits(A)).length;
      await put(A, 'docMain', '/doctor-profiles/me', { registrationNo: '<x>' });
      await put(A, 'adminMain', `/doctor-profiles/${A.docs.docEast}`, { speciality: 'x' });
      expect((await audits(A)).length).toBe(before);
    });
  });

  describe('concurrency', () => {
    it('two saves at once leave one of them whole, never a mix and never an error', async () => {
      const results = await Promise.all([
        put(A, 'docMain', '/doctor-profiles/me', { speciality: 'One', qualifications: 'One' }),
        put(A, 'docMain', '/doctor-profiles/me', { speciality: 'Two', qualifications: 'Two' }),
        put(A, 'superAdmin', `/doctor-profiles/${A.docs.docMain}`, {
          speciality: 'Three',
          qualifications: 'Three',
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const profile = await row(A.docs.docMain);
      expect(['One', 'Two', 'Three']).toContain(profile.speciality);
      expect(profile.qualifications).toBe(profile.speciality);
      await owner.doctorProfile.update({
        where: { id: A.docs.docMain },
        data: { speciality: null, qualifications: null },
      });
    });
  });
});
