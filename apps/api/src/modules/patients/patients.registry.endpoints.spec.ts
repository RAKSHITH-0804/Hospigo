/**
 * Patient registry HTTP API (Phase 2 Step 3a).
 */
import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createOwnerPrisma, createPgClient, withTenant } from '../../database/db-test.util';
import { HospigoValidationPipe } from './patient-dto-validation';
import { uniqueValidTestPhone } from './test-register.helpers';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function requireAppTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_TEST required');
  if (new URL(url).pathname.replace(/^\//, '') !== 'hospigo_test') {
    throw new Error('Expected hospigo_test');
  }
  return url;
}

function requireOwnerTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_OWNER_TEST || process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('DATABASE_URL_OWNER_TEST required');
  if (new URL(url).pathname.replace(/^\//, '') !== 'hospigo_test') {
    throw new Error('Expected hospigo_test');
  }
  return url;
}

function rewriteToTestDb(envKey: string): string {
  const raw = process.env[envKey];
  if (!raw) throw new Error(`${envKey} required`);
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

const appDatabaseUrl = requireAppTestDatabaseUrl();
const ownerDatabaseUrl = requireOwnerTestDatabaseUrl();

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: appDatabaseUrl,
  DATABASE_URL_OWNER: ownerDatabaseUrl,
  DATABASE_URL_HQ: rewriteToTestDb('DATABASE_URL_HQ'),
  DATABASE_URL_PATIENT: rewriteToTestDb('DATABASE_URL_PATIENT'),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  AUTH_IP_RATE_LIMIT_PER_MIN: '200',
  PATIENT_SEARCH_MAX_PAGE_SIZE: '50',
  PATIENT_SEARCH_MIN_NAME_LENGTH: '3',
  PATIENT_LIST_Q_MAX_LENGTH: '64',
  PATIENT_LIST_Q_MIN_NAME_LENGTH: '2',
  PATIENT_LIST_Q_MIN_UHID_LENGTH: '2',
  PATIENT_LIST_Q_MIN_PHONE_DIGITS: '3',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
});

const TEST_PREFIX = 'hospigo:pat:reg:';
const ROUTES = [
  { method: 'get' as const, path: '/patients/form-config' },
  { method: 'get' as const, path: '/patients/search?name=Abc' },
  { method: 'get' as const, path: '/patients' },
  { method: 'get' as const, path: '/patients/uhid/start-number' },
  { method: 'get' as const, path: '/patients/000000000000000000000000' },
  { method: 'post' as const, path: '/patients' },
  { method: 'patch' as const, path: '/patients/000000000000000000000000' },
  { method: 'put' as const, path: '/patients/uhid/start-number' },
];

describe('Patients registry endpoints (HTTP)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('../auth/auth-redis.service').AuthRedisService;
  let tokens: import('../auth/token.service').TokenService;
  let password: string;

  let northAccess: string;
  let northEastAccess: string;
  let southAccess: string;
  let northRecvEmail: string;
  let northNurseEmail: string;
  let northStaffNoPermEmail: string;
  let northAdminEmail: string;
  let southRecvEmail: string;
  let southAdminEmail: string;
  let northTenantId: string;
  let southTenantId: string;
  let northMainId: string;
  let northEastId: string;
  let hqEmail: string;
  let patientAccountId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    password = 'CorrectHorse9!';
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    northAccess = `preg-n-${stamp}`;
    northEastAccess = `preg-n-e-${stamp}`;
    southAccess = `preg-s-${stamp}`;
    northRecvEmail = `preg_rc_n_${stamp}@example.test`;
    northNurseEmail = `preg_nu_n_${stamp}@example.test`;
    northStaffNoPermEmail = `preg_np_n_${stamp}@example.test`;
    northAdminEmail = `preg_sa_n_${stamp}@example.test`;
    southRecvEmail = `preg_rc_s_${stamp}@example.test`;
    southAdminEmail = `preg_sa_s_${stamp}@example.test`;
    hqEmail = `preg_hq_${stamp}@example.test`;

    for (const code of [
      'patients.registry.read',
      'patients.registry.write',
      'hospital.settings.read',
      'hospital.settings.write',
    ]) {
      await owner.permission.upsert({
        where: { code },
        create: { code, description: code },
        update: { isActive: true },
      });
    }
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const perms = await owner.permission.findMany({
      where: {
        code: {
          in: [
            'patients.registry.read',
            'patients.registry.write',
            'hospital.settings.read',
            'hospital.settings.write',
          ],
        },
      },
    });
    const byCode = Object.fromEntries(perms.map((p) => [p.code, p.id]));

    await owner.patientFieldCatalog.upsert({
      where: { key: 'name' },
      create: {
        key: 'name',
        defaultLabel: 'Full name',
        dataType: 'TEXT',
        canDisable: false,
        alwaysRequired: true,
        defaultSection: 'PERSONAL',
      },
      update: {
        alwaysRequired: true,
        canDisable: false,
        defaultSection: 'PERSONAL',
      },
    });
    for (const row of [
      {
        key: 'gender',
        dataType: 'TEXT',
        canDisable: true,
        alwaysRequired: false,
        defaultSection: 'PERSONAL' as const,
      },
      {
        key: 'date_of_birth',
        dataType: 'DATE',
        canDisable: false,
        alwaysRequired: true,
        defaultSection: 'PERSONAL' as const,
      },
      {
        key: 'phone',
        dataType: 'TEXT',
        canDisable: false,
        alwaysRequired: true,
        defaultSection: 'CONTACT' as const,
      },
      {
        key: 'email',
        dataType: 'TEXT',
        canDisable: true,
        alwaysRequired: false,
        defaultSection: 'CONTACT' as const,
      },
      {
        key: 'address_pincode',
        dataType: 'TEXT',
        canDisable: true,
        alwaysRequired: false,
        defaultSection: 'ADDRESS' as const,
      },
    ]) {
      await owner.patientFieldCatalog.upsert({
        where: { key: row.key },
        create: {
          key: row.key,
          defaultLabel: row.key,
          dataType: row.dataType,
          canDisable: row.canDisable,
          alwaysRequired: row.alwaysRequired,
          defaultSection: row.defaultSection,
        },
        update: {
          canDisable: row.canDisable,
          alwaysRequired: row.alwaysRequired,
          defaultSection: row.defaultSection,
        },
      });
    }

    async function seedHospital(args: {
      code: string;
      accessMain: string;
      accessEast?: string;
      recvEmail: string;
      nurseEmail?: string;
      adminEmail?: string;
      noPermEmail?: string;
      withCustomTitle: boolean;
      phoneRequired: boolean;
      uhidPrefix: string;
    }) {
      const branches = args.accessEast
        ? [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: args.accessMain },
            { code: 'EAST', name: 'East', isMain: false, accessCode: args.accessEast },
          ]
        : [{ code: 'MAIN', name: 'Main', isMain: true, accessCode: args.accessMain }];
      const hospital = await owner.hospital.create({
        data: {
          code: args.code,
          name: `${args.code} Hospital`,
          isTest: true,
          branches: { create: branches },
        },
        include: { branches: true },
      });
      const tenantId = hospital.id;
      const mainId = hospital.branches.find((b) => b.code === 'MAIN')!.id;
      const eastId = hospital.branches.find((b) => b.code === 'EAST')?.id;

      await owner.hospitalModuleSubscription.create({
        data: { tenantId, moduleId: opd.id },
      });
      for (const branchId of [mainId, eastId].filter(Boolean) as string[]) {
        await owner.branchModule.create({
          data: {
            tenantId,
            branchId,
            moduleId: opd.id,
            enabledByIndigo: true,
            restrictedByHospital: false,
            isActive: true,
          },
        });
      }

      await owner.opdSettings.create({
        data: { tenantId, timezone: 'Asia/Kolkata', tokenPrefix: 'T' },
      });

      const catalog = await owner.patientFieldCatalog.findMany();
      let order = 0;
      for (const c of catalog) {
        await owner.patientFieldSetting.create({
          data: {
            tenantId,
            catalogKey: c.key,
            isEnabled: true,
            isRequired:
              c.alwaysRequired || c.key === 'name'
                ? true
                : c.key === 'phone'
                  ? args.phoneRequired
                  : false,
            label: c.defaultLabel,
            sortOrder: order++,
          },
        });
      }

      if (args.withCustomTitle) {
        const field = await owner.patientCustomField.create({
          data: {
            tenantId,
            code: 'title',
            label: 'Title',
            dataType: 'DROPDOWN',
            section: 'RELATIVE',
            isActive: true,
            options: {
              create: [
                { label: 'Mr', sortOrder: 0 },
                { label: 'Mrs', sortOrder: 1 },
              ],
            },
          },
        });
        await owner.patientFieldSetting.create({
          data: {
            tenantId,
            customFieldId: field.id,
            isEnabled: true,
            isRequired: false,
            label: 'Title',
            sortOrder: 100,
          },
        });
      }

      const admin = await owner.user.create({
        data: {
          tenantId,
          code: 'SA1',
          email: args.adminEmail ?? `sa_${args.code.toLowerCase()}@example.test`,
          displayName: 'Admin',
          passwordHash: hash,
          mustChangePassword: false,
        },
      });
      const recv = await owner.user.create({
        data: {
          tenantId,
          code: 'RC1',
          email: args.recvEmail,
          displayName: 'Recv',
          passwordHash: hash,
          mustChangePassword: false,
        },
      });
      await owner.userBranch.create({ data: { tenantId, userId: admin.id, branchId: mainId } });
      await owner.userBranch.create({ data: { tenantId, userId: recv.id, branchId: mainId } });
      if (eastId) {
        await owner.userBranch.create({ data: { tenantId, userId: recv.id, branchId: eastId } });
      }

      const roleAdmin = await owner.role.create({
        data: { tenantId, code: 'SUPER_ADMIN', name: 'SuperAdmin', isSystem: true },
      });
      for (const pid of Object.values(byCode)) {
        await owner.rolePermission.create({
          data: { tenantId, roleId: roleAdmin.id, permissionId: pid },
        });
      }
      await owner.roleAssignment.create({
        data: {
          tenantId,
          userId: admin.id,
          roleId: roleAdmin.id,
          scopeType: 'HOSPITAL',
        },
      });

      const roleRecv = await owner.role.create({
        data: { tenantId, code: 'RECEPTIONIST', name: 'Receptionist' },
      });
      for (const code of ['patients.registry.read', 'patients.registry.write']) {
        await owner.rolePermission.create({
          data: { tenantId, roleId: roleRecv.id, permissionId: byCode[code]! },
        });
      }
      await owner.roleAssignment.create({
        data: {
          tenantId,
          userId: recv.id,
          roleId: roleRecv.id,
          scopeType: 'HOSPITAL',
        },
      });

      if (args.nurseEmail) {
        const nurse = await owner.user.create({
          data: {
            tenantId,
            code: 'NU1',
            email: args.nurseEmail,
            displayName: 'Nurse',
            passwordHash: hash,
            mustChangePassword: false,
          },
        });
        await owner.userBranch.create({ data: { tenantId, userId: nurse.id, branchId: mainId } });
        const roleNurse = await owner.role.create({
          data: { tenantId, code: 'NURSE', name: 'Nurse' },
        });
        await owner.rolePermission.create({
          data: {
            tenantId,
            roleId: roleNurse.id,
            permissionId: byCode['patients.registry.read']!,
          },
        });
        await owner.roleAssignment.create({
          data: {
            tenantId,
            userId: nurse.id,
            roleId: roleNurse.id,
            scopeType: 'HOSPITAL',
          },
        });
      }

      if (args.noPermEmail) {
        const none = await owner.user.create({
          data: {
            tenantId,
            code: 'NP1',
            email: args.noPermEmail,
            displayName: 'NoPerm',
            passwordHash: hash,
            mustChangePassword: false,
          },
        });
        await owner.userBranch.create({ data: { tenantId, userId: none.id, branchId: mainId } });
        const roleNone = await owner.role.create({
          data: { tenantId, code: 'NONE', name: 'None' },
        });
        await owner.roleAssignment.create({
          data: {
            tenantId,
            userId: none.id,
            roleId: roleNone.id,
            scopeType: 'HOSPITAL',
          },
        });
      }

      await owner.uhidFormatConfig.create({
        data: {
          tenantId,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          resetRule: 'NEVER',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          createdBy: admin.id,
          blocks: {
            create: [
              { position: 1, blockType: 'FIXED_TEXT', textValue: args.uhidPrefix },
              { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 4 },
            ],
          },
        },
      });

      return { tenantId, mainId, eastId, adminId: admin.id };
    }

    const north = await seedHospital({
      code: `PREG_N_${stamp}`,
      accessMain: northAccess,
      accessEast: northEastAccess,
      recvEmail: northRecvEmail,
      nurseEmail: northNurseEmail,
      adminEmail: northAdminEmail,
      noPermEmail: northStaffNoPermEmail,
      withCustomTitle: true,
      phoneRequired: false,
      uhidPrefix: 'NREG',
    });
    northTenantId = north.tenantId;
    northMainId = north.mainId;
    northEastId = north.eastId!;

    const south = await seedHospital({
      code: `PREG_S_${stamp}`,
      accessMain: southAccess,
      recvEmail: southRecvEmail,
      adminEmail: southAdminEmail,
      withCustomTitle: false,
      phoneRequired: true,
      uhidPrefix: 'SREG',
    });
    southTenantId = south.tenantId;

    await owner.hqUser.create({
      data: {
        email: hqEmail,
        displayName: 'HQ',
        passwordHash: hash,
        mustChangePassword: false,
        isActive: true,
      },
    });
    const patient = await owner.patientAccount.create({
      data: {
        phoneE164: `+9198${String(stamp).slice(-8)}`,
      },
    });
    patientAccountId = patient.id;

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useGlobalPipes(new HospigoValidationPipe());
    await app.init();
    redis = app.get((await import('../auth/auth-redis.service')).AuthRedisService);
    tokens = app.get((await import('../auth/token.service')).TokenService);
    redis.setKeyPrefix(TEST_PREFIX);
  }, 180_000);

  afterAll(async () => {
    await redis?.clearPrefixKeys();
    await app?.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await redis.clearPrefixKeys();
  });

  async function hospitalLogin(accessCode: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function hqToken(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/hq/login')
      .send({ email: hqEmail, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function patientToken(): Promise<string> {
    return tokens.signPatientAccess({ accountId: patientAccountId });
  }

  it('refuses no token, patient token, HQ token, and missing permission on every route', async () => {
    const patientTok = await patientToken();
    const hqTok = await hqToken();
    const noPerm = await hospitalLogin(northAccess, northStaffNoPermEmail);

    for (const route of ROUTES) {
      const bare = request(app.getHttpServer())[route.method](route.path);
      await bare.expect(401);

      const asPatient = request(app.getHttpServer())
        [route.method](route.path)
        .set('Authorization', `Bearer ${patientTok}`);
      // Wrong token kind → AuthGuard 401 (Token type not allowed).
      if (route.method === 'post' || route.method === 'patch' || route.method === 'put') {
        await asPatient.send({}).expect(401);
      } else {
        await asPatient.expect(401);
      }

      const asHq = request(app.getHttpServer())
        [route.method](route.path)
        .set('Authorization', `Bearer ${hqTok}`);
      if (route.method === 'post' || route.method === 'patch' || route.method === 'put') {
        await asHq.send({}).expect(401);
      } else {
        await asHq.expect(401);
      }

      const asNoPerm = request(app.getHttpServer())
        [route.method](route.path)
        .set('Authorization', `Bearer ${noPerm}`);
      if (route.method === 'post' || route.method === 'patch' || route.method === 'put') {
        await asNoPerm.send({ name: 'X', reason: 'x', startNumber: 1 }).expect(403);
      } else {
        await asNoPerm.expect(403);
      }
    }
  });

  it('Receptionist can register, search and update; Nurse search only', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const nurse = await hospitalLogin(northAccess, northNurseEmail);

    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Mock Alpha', gender: 'F', dateOfBirth: '1990-01-15', phone: '9876543210' });
    expect([200, 201]).toContain(created.status);
    expect(created.body.id).toBeDefined();
    expect(created.body.uhid).toMatch(/^NREG/);

    await request(app.getHttpServer())
      .get('/patients/search')
      .query({ phone: '9876543210' })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/patients/search')
      .query({ name: 'Mock' })
      .set('Authorization', `Bearer ${nurse}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ name: 'Nurse Blocked', dateOfBirth: '1991-01-01' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/patients/${created.body.id}`)
      .set('Authorization', `Bearer ${recv}`)
      .send({ gender: 'M' })
      .expect(200);
  });

  it('form-config differs (NORTH custom title vs SOUTH); required phone on SOUTH', async () => {
    const northTok = await hospitalLogin(northAccess, northRecvEmail);
    const southTok = await hospitalLogin(southAccess, southRecvEmail);

    const northCfg = await request(app.getHttpServer())
      .get('/patients/form-config')
      .set('Authorization', `Bearer ${northTok}`)
      .expect(200);
    const southCfg = await request(app.getHttpServer())
      .get('/patients/form-config')
      .set('Authorization', `Bearer ${southTok}`)
      .expect(200);

    const northCodes = (northCfg.body.fields as Array<{ code?: string; key?: string }>).map(
      (f) => f.code ?? f.key,
    );
    const southCodes = (southCfg.body.fields as Array<{ code?: string; key?: string }>).map(
      (f) => f.code ?? f.key,
    );
    expect(northCodes).toContain('title');
    expect(southCodes).not.toContain('title');
    expect(northCodes).toContain('name');

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${southTok}`)
      .send({ name: 'South No Phone', dateOfBirth: '1992-02-02' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${southTok}`)
      .send({ name: 'South With Phone', dateOfBirth: '1992-02-02', phone: '9123456780' })
      .expect((res) => expect([200, 201]).toContain(res.status));
  });

  it('age converts to estimated DOB; both age and DOB is 400; phones validated and normalised', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Both Fields', dateOfBirth: '1990-01-01', ageYears: 30 })
      .expect(400);

    const byAge = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Age Only', ageYears: 34, phone: '9988776655' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    const detail = await request(app.getHttpServer())
      .get(`/patients/${byAge.body.id}`)
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(detail.body.dobIsEstimated).toBe(true);
    expect(detail.body.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.body.phone).toBe('+919988776655');

    const landline = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Landline', dateOfBirth: '1990-01-01', phone: '02212345678' })
      .expect(400);
    expect(landline.body.fieldErrors?.phone).toBe('INVALID');

    const badPhone = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Bad Phone', dateOfBirth: '1990-01-01', phone: '12345' })
      .expect(400);
    expect(badPhone.body.fieldErrors?.phone).toBe('INVALID');
  });

  it('20 parallel registrations across two branches give distinct UHIDs', async () => {
    const mainTok = await hospitalLogin(northAccess, northRecvEmail);
    const eastTok = await hospitalLogin(northEastAccess, northRecvEmail);
    void northMainId;
    void northEastId;

    const jobs = Array.from({ length: 20 }, (_, i) => {
      const tok = i % 2 === 0 ? mainTok : eastTok;
      return request(app.getHttpServer())
        .post('/patients')
        .set('Authorization', `Bearer ${tok}`)
        .send({
          name: `Parallel ${i}`,
          dateOfBirth: '1988-03-03',
          phone: `98${String(10000000 + i).padStart(8, '0')}`,
        });
    });
    const results = await Promise.all(jobs);
    const uhids = results.map((r) => {
      expect([200, 201]).toContain(r.status);
      return r.body.uhid as string;
    });
    expect(new Set(uhids).size).toBe(20);
  });

  it('duplicate warning and confirmDuplicate path', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Dup Person', dateOfBirth: '1985-05-05', phone: '9000011111' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    const dup = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Dup Person', dateOfBirth: '1985-05-05', phone: '9000011111' })
      .expect(409);
    expect(dup.body.code).toBe('POSSIBLE_DUPLICATE');
    expect(Array.isArray(dup.body.matches)).toBe(true);

    // The use case asks for the same mobile, the same name AND the same date of birth: another
    // birth date is not a possible duplicate.
    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Dup Person', dateOfBirth: '1990-01-01', phone: '9000011111' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    // confirmDuplicate must be a real boolean: the text "false" (or "true") is refused, and it
    // never counts as a confirmation.
    for (const text of ['false', 'true', '1']) {
      const refused = await request(app.getHttpServer())
        .post('/patients')
        .set('Authorization', `Bearer ${recv}`)
        .send({
          name: 'Dup Person',
          dateOfBirth: '1985-05-05',
          phone: '9000011111',
          confirmDuplicate: text,
        });
      expect(refused.status).toBe(400);
    }

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({
        name: 'Dup Person',
        dateOfBirth: '1985-05-05',
        phone: '9000011111',
        confirmDuplicate: true,
      })
      .expect((res) => expect([200, 201]).toContain(res.status));
  });

  it('search criteria, min name length, page cap, hospital isolation, GET/PATCH rules, audits, start-number', async () => {
    const northTok = await hospitalLogin(northAccess, northRecvEmail);
    const southTok = await hospitalLogin(southAccess, southRecvEmail);
    const adminTok = await hospitalLogin(northAccess, northAdminEmail);

    await request(app.getHttpServer())
      .get('/patients/search')
      .set('Authorization', `Bearer ${northTok}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/patients/search')
      .query({ name: 'Ab', phone: '9876543210' })
      .set('Authorization', `Bearer ${northTok}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/patients/search')
      .query({ name: 'Ab' })
      .set('Authorization', `Bearer ${northTok}`)
      .expect(400);

    const page = await request(app.getHttpServer())
      .get('/patients/search')
      .query({ name: 'Mock', pageSize: 999 })
      .set('Authorization', `Bearer ${northTok}`)
      .expect(200);
    expect(page.body.pageSize).toBeLessThanOrEqual(50);

    const southSearch = await request(app.getHttpServer())
      .get('/patients/search')
      .query({ name: 'Mock' })
      .set('Authorization', `Bearer ${southTok}`)
      .expect(200);
    expect(
      (southSearch.body.items as Array<{ uhid: string }>).every((i) => i.uhid.startsWith('SREG')),
    ).toBe(true);

    const northCreated = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${northTok}`)
      .send({ name: 'View Target', dateOfBirth: '1993-03-03', phone: '9111222333' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    await request(app.getHttpServer())
      .get(`/patients/${northCreated.body.id}`)
      .set('Authorization', `Bearer ${southTok}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/patients/${northCreated.body.id}`)
      .set('Authorization', `Bearer ${northTok}`)
      .send({ uhid: 'HACKED' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/patients/${northCreated.body.id}`)
      .set('Authorization', `Bearer ${northTok}`)
      .send({ registeredBranchId: northEastId })
      .expect(400);

    const client = createPgClient('app');
    await client.connect();
    try {
      await withTenant(client, northTenantId, async () => {
        await expect(
          client.query(`UPDATE patients SET uhid = 'HACKED' WHERE id = $1`, [northCreated.body.id]),
        ).rejects.toThrow(/immutable/i);
      });
    } finally {
      await client.end();
    }

    await request(app.getHttpServer())
      .get(`/patients/${northCreated.body.id}`)
      .set('Authorization', `Bearer ${northTok}`)
      .expect(200);

    const audits = await owner.auditLog.findMany({
      where: {
        tenantId: northTenantId,
        entityId: northCreated.body.id,
        action: { in: ['PATIENT_VIEW', 'PATIENT_REGISTER', 'PATIENT_UPDATE'] },
      },
    });
    expect(audits.some((a) => a.action === 'PATIENT_VIEW')).toBe(true);
    expect(audits.some((a) => a.action === 'PATIENT_REGISTER')).toBe(true);
    for (const a of audits) {
      const meta = JSON.stringify(a.metadata ?? {});
      expect(meta).not.toMatch(/9111222333|View Target|\+91/);
    }

    await request(app.getHttpServer())
      .put('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${northTok}`)
      .send({ startNumber: 5000, reason: 'skip block' })
      .expect(403);

    await request(app.getHttpServer())
      .put('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ startNumber: 5000, reason: 'skip imported block' })
      .expect(200);

    await request(app.getHttpServer())
      .put('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ startNumber: 10, reason: 'lower refused' })
      .expect(400);
  });

  it('GET /patients/uhid/start-number is not captured as /patients/:id', async () => {
    const adminTok = await hospitalLogin(northAccess, northAdminEmail);
    const res = await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(res.body.nextNumber).toBeDefined();
    expect(res.body.nextUhidPreview).toBeDefined();
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('uhid');
  });

  it('GET uhid/start-number: preview, no writes, auth, isolation; PUT raises current NEVER period', async () => {
    const adminTok = await hospitalLogin(northAccess, northAdminEmail);
    const southAdminTok = await hospitalLogin(southAccess, southAdminEmail);

    const beforeCounters = await owner.uhidCounter.count({ where: { tenantId: northTenantId } });
    const beforeAudits = await owner.auditLog.count({
      where: { tenantId: northTenantId, action: 'UHID_SET_START_NUMBER' },
    });

    const first = await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(first.body.nextNumber).toBeGreaterThanOrEqual(1);
    expect(first.body.nextUhidPreview).toMatch(/^NREG/);
    expect(first.body.resetRule).toBe('NEVER');
    expect(first.body.periodYear).toBe(0);
    expect(first.body.periodLabel).toBeNull();

    const second = await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(second.body.nextNumber).toBe(first.body.nextNumber);
    expect(second.body.nextUhidPreview).toBe(first.body.nextUhidPreview);

    expect(await owner.uhidCounter.count({ where: { tenantId: northTenantId } })).toBe(
      beforeCounters,
    );
    expect(
      await owner.auditLog.count({
        where: { tenantId: northTenantId, action: 'UHID_SET_START_NUMBER' },
      }),
    ).toBe(beforeAudits);

    const recv = await hospitalLogin(northAccess, northRecvEmail);
    await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${recv}`)
      .expect(403);

    await request(app.getHttpServer()).get('/patients/uhid/start-number').expect(401);

    const southPreview = await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${southAdminTok}`)
      .expect(200);
    expect(southPreview.body.nextUhidPreview).toMatch(/^SREG/);
    expect(southPreview.body.nextUhidPreview).not.toBe(first.body.nextUhidPreview);
    expect(southTenantId).not.toBe(northTenantId);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'After Preview', dateOfBirth: '1994-04-04', phone: '9111000222' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    const afterReg = await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(afterReg.body.nextNumber).toBe(first.body.nextNumber + 1);

    const raiseTo = afterReg.body.nextNumber + 100;
    await request(app.getHttpServer())
      .put('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ startNumber: raiseTo, reason: 'raise never period' })
      .expect(200);

    await request(app.getHttpServer())
      .put('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ startNumber: raiseTo - 1, reason: 'decrease refused' })
      .expect(400);

    await request(app.getHttpServer())
      .put('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ startNumber: raiseTo + 1, reason: '   ' })
      .expect(400);

    const audit = await owner.auditLog.findFirst({
      where: { tenantId: northTenantId, action: 'UHID_SET_START_NUMBER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect((audit!.metadata as { periodYear?: number }).periodYear).toBe(0);

    const afterRaise = await request(app.getHttpServer())
      .get('/patients/uhid/start-number')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(afterRaise.body.nextNumber).toBe(raiseTo);

    const nextPatient = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Raised Number', dateOfBirth: '1995-05-05', phone: '9111000333' })
      .expect((res) => expect([200, 201]).toContain(res.status));
    expect(nextPatient.body.uhid).toBe(afterRaise.body.nextUhidPreview);
  });

  it('audit entries contain no personal data', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const forbidden = [
      'Zebulon',
      'Qwerty',
      '9000000042',
      '+919000000042',
      'example.test',
      'Unique Lane',
    ];

    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({
        name: 'Zebulon Qwerty',
        gender: 'M',
        dateOfBirth: '1987-07-07',
        phone: '9000000042',
        email: 'zebulon.qwerty@example.test',
        addressStreet: 'Unique Lane 77',
      });
    expect([200, 201]).toContain(created.status);
    const patientId = created.body.id as string;

    await request(app.getHttpServer())
      .get(`/patients/${patientId}`)
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/patients/${patientId}`)
      .set('Authorization', `Bearer ${recv}`)
      .send({
        email: 'updated.contact@other.test',
        name: 'Updated Contact',
        addressStreet: 'Other Road 1',
      })
      .expect(200);

    const audits = await owner.auditLog.findMany({
      where: { entityType: 'patient', entityId: patientId },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['PATIENT_REGISTER', 'PATIENT_VIEW', 'PATIENT_UPDATE']),
    );

    for (const row of audits) {
      const blob = `${JSON.stringify(row.metadata ?? {})}${row.reason ?? ''}`;
      for (const needle of forbidden) {
        expect(blob).not.toContain(needle);
      }
    }

    const register = audits.find((a) => a.action === 'PATIENT_REGISTER');
    expect(register).toBeDefined();
    expect(Object.keys(register!.metadata as object).sort()).toEqual(['branchId', 'uhid']);

    const view = audits.find((a) => a.action === 'PATIENT_VIEW');
    expect(view).toBeDefined();
    expect(view!.metadata).toEqual({});

    const update = audits.find((a) => a.action === 'PATIENT_UPDATE');
    expect(update).toBeDefined();
    const updateMeta = update!.metadata as { changedFields?: unknown };
    expect(Object.keys(updateMeta)).toEqual(['changedFields']);
    expect(Array.isArray(updateMeta.changedFields)).toBe(true);
    const fields = updateMeta.changedFields as string[];
    expect(fields).toEqual(expect.arrayContaining(['email', 'name', 'addressStreet']));
    for (const field of fields) {
      expect(typeof field).toBe('string');
      for (const needle of forbidden) {
        expect(field).not.toContain(needle);
      }
    }

    const beforeSearch = await owner.auditLog.count({
      where: { tenantId: northTenantId, entityType: 'patient' },
    });
    await request(app.getHttpServer())
      .get('/patients/search')
      .query({ phone: '9000000042' })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    const afterSearch = await owner.auditLog.count({
      where: { tenantId: northTenantId, entityType: 'patient' },
    });
    expect(afterSearch).toBe(beforeSearch);
  });

  it('GET /patients list: sorts, pagination, filters, isolation, route order, branch name', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const eastTok = await hospitalLogin(northEastAccess, northRecvEmail);
    const southTok = await hospitalLogin(southAccess, southRecvEmail);
    const tieTime = new Date('2026-01-15T12:00:00.000Z');

    const seedRows: Array<{
      name: string;
      phone: string;
      createdAt: Date;
      token: string;
    }> = [
      {
        name: 'List Zebra',
        phone: uniqueValidTestPhone(),
        createdAt: new Date('2026-01-10T10:00:00.000Z'),
        token: recv,
      },
      {
        name: 'List Alpha',
        phone: uniqueValidTestPhone(),
        createdAt: tieTime,
        token: recv,
      },
      {
        name: 'List Beta',
        phone: uniqueValidTestPhone(),
        createdAt: tieTime,
        token: eastTok,
      },
      {
        name: 'List Middle',
        phone: uniqueValidTestPhone(),
        createdAt: new Date('2026-01-20T10:00:00.000Z'),
        token: recv,
      },
    ];

    const createdIds: string[] = [];
    for (const row of seedRows) {
      const res = await request(app.getHttpServer())
        .post('/patients')
        .set('Authorization', `Bearer ${row.token}`)
        .send({
          name: row.name,
          dateOfBirth: '1990-01-01',
          phone: row.phone,
        });
      expect([200, 201]).toContain(res.status);
      createdIds.push(res.body.id);
      // Backdate created_at for sort coverage (identity columns stay immutable).
      await owner.patient.update({
        where: { id: res.body.id },
        data: { createdAt: row.createdAt },
      });
    }

    const newest = await request(app.getHttpServer())
      .get('/patients')
      .query({ sort: 'newest', name: 'List', pageSize: 50 })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(newest.body.items[0].name).toBe('List Middle');
    expect(newest.body.items[0].registeredBranchName).toBeTruthy();
    expect(newest.body.items[0].createdAt).toBeDefined();
    expect(newest.body.items[0].registeredBranchId).toBeDefined();

    const oldest = await request(app.getHttpServer())
      .get('/patients')
      .query({ sort: 'oldest', name: 'List', pageSize: 50 })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(oldest.body.items[0].name).toBe('List Zebra');

    const nameAsc = await request(app.getHttpServer())
      .get('/patients')
      .query({ sort: 'name_asc', name: 'List', pageSize: 50 })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    const ascNames = (nameAsc.body.items as Array<{ name: string }>).map((i) => i.name);
    expect(ascNames).toEqual([...ascNames].sort((a, b) => a.localeCompare(b)));

    const nameDesc = await request(app.getHttpServer())
      .get('/patients')
      .query({ sort: 'name_desc', name: 'List', pageSize: 50 })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    const descNames = (nameDesc.body.items as Array<{ name: string }>).map((i) => i.name);
    expect(descNames[0]).toBe('List Zebra');

    // created_at tie: Alpha and Beta share timestamp; id DESC for newest among ties.
    const tiedNewest = (newest.body.items as Array<{ name: string; id: string }>).filter((i) =>
      ['List Alpha', 'List Beta'].includes(i.name),
    );
    expect(tiedNewest).toHaveLength(2);
    expect(tiedNewest[0]!.id > tiedNewest[1]!.id).toBe(true);

    const page1 = await request(app.getHttpServer())
      .get('/patients')
      .query({ sort: 'name_asc', name: 'List', page: 1, pageSize: 2 })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.total).toBeGreaterThanOrEqual(4);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);

    const byPhone = await request(app.getHttpServer())
      .get('/patients')
      .query({ phone: seedRows[0]!.phone, sort: 'newest' })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(byPhone.body.total).toBe(1);
    expect(byPhone.body.items[0].name).toBe('List Zebra');

    const byUhid = await request(app.getHttpServer())
      .get('/patients')
      .query({ uhid: newest.body.items[0].uhid })
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(byUhid.body.total).toBe(1);

    await request(app.getHttpServer())
      .get('/patients')
      .query({ name: 'List', phone: seedRows[0]!.phone })
      .set('Authorization', `Bearer ${recv}`)
      .expect(400);

    const southList = await request(app.getHttpServer())
      .get('/patients')
      .query({ name: 'List' })
      .set('Authorization', `Bearer ${southTok}`)
      .expect(200);
    expect(
      (southList.body.items as Array<{ id: string }>).every((i) => !createdIds.includes(i.id)),
    ).toBe(true);

    // Route order: /patients is list; /patients/uhid/start-number not captured as :id;
    // /patients/:id still works.
    const listBare = await request(app.getHttpServer())
      .get('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(Array.isArray(listBare.body.items)).toBe(true);

    const eastName = (
      newest.body.items as Array<{ name: string; registeredBranchName: string }>
    ).find((i) => i.name === 'List Beta');
    expect(eastName?.registeredBranchName).toBe('East');
  });

  describe('GET /patients list q=', () => {
    const qPhone = '7000012399';
    const qPhoneE164 = `+91${qPhone}`;
    let recv: string;
    let southTok: string;
    let sahilId: string;
    let sahilUhid: string;
    let phoneId: string;
    let digitNameId: string;

    async function registerQPatient(name: string, phone: string) {
      const res = await request(app.getHttpServer())
        .post('/patients')
        .set('Authorization', `Bearer ${recv}`)
        .send({ name, dateOfBirth: '1990-01-01', phone });
      expect([200, 201]).toContain(res.status);
      return res.body as { id: string; uhid: string };
    }

    beforeAll(async () => {
      recv = await hospitalLogin(northAccess, northRecvEmail);
      southTok = await hospitalLogin(southAccess, southRecvEmail);
      const sahil = await registerQPatient('Seed Sahil Sharma', uniqueValidTestPhone());
      sahilId = sahil.id;
      sahilUhid = sahil.uhid;
      const byPhone = await registerQPatient('Qtest Phone Only', qPhone);
      phoneId = byPhone.id;
      const digitName = await registerQPatient('700 Club Member', uniqueValidTestPhone());
      digitNameId = digitName.id;
    });

    it('matches name prefix', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: 'Seed' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect((res.body.items as Array<{ id: string }>).some((i) => i.id === sahilId)).toBe(true);
    });

    it('matches second-word name prefix', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: 'sahil' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect((res.body.items as Array<{ id: string }>).some((i) => i.id === sahilId)).toBe(true);
    });

    it('matches UHID prefix with lower-case input', async () => {
      const prefix = sahilUhid.slice(0, Math.min(4, sahilUhid.length)).toLowerCase();
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: prefix })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect((res.body.items as Array<{ id: string }>).some((i) => i.id === sahilId)).toBe(true);
    });

    it('matches phone prefix with spaces', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: '700 00' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect(
        (res.body.items as Array<{ id: string; phone: string }>).some((i) => i.id === phoneId),
      ).toBe(true);
      expect(
        (res.body.items as Array<{ id: string; phone: string }>).find((i) => i.id === phoneId)
          ?.phone,
      ).toBe(qPhoneE164);
    });

    it('matches phone prefix with +91', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: '+91 700' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect((res.body.items as Array<{ id: string }>).some((i) => i.id === phoneId)).toBe(true);
    });

    it('matches digits-only q across name and phone fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: '700' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids).toEqual(expect.arrayContaining([phoneId, digitNameId]));
    });

    it('treats LIKE wildcards in q as literals', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: '%%' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect(res.body.total).toBe(0);
      const under = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: '__' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect(under.body.total).toBe(0);
    });

    it('rejects q combined with another filter', async () => {
      await request(app.getHttpServer())
        .get('/patients')
        .query({ q: 'Seed', name: 'Seed' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(400);
    });

    it('rejects q shorter than every applicable minimum', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: 'a' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(400);
      expect(res.body.fieldErrors?.q).toBe('INVALID');
    });

    it('keeps tenant isolation for q', async () => {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: 'sahil' })
        .set('Authorization', `Bearer ${southTok}`)
        .expect(200);
      expect((res.body.items as Array<{ id: string }>).every((i) => i.id !== sahilId)).toBe(true);
    });

    it('applies sort and pagination with q', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/patients')
        .query({ q: 'Qtest', sort: 'name_asc', page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${recv}`)
        .expect(200);
      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.page).toBe(1);
      expect(page1.body.pageSize).toBe(1);
      expect(page1.body.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /patients list uhid sort', () => {
    let recv: string;
    let southTok: string;
    let actorId: string;
    let southActorId: string;

    async function addPatient(
      tenantId: string,
      branchId: string,
      createdBy: string,
      name: string,
      uhid: string,
    ) {
      return owner.patient.create({
        data: { tenantId, uhid, registeredBranchId: branchId, name, createdBy },
      });
    }

    async function listUhids(
      token: string,
      query: Record<string, string | number>,
    ): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .get('/patients')
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return (res.body.items as Array<{ uhid: string }>).map((i) => i.uhid);
    }

    beforeAll(async () => {
      recv = await hospitalLogin(northAccess, northRecvEmail);
      southTok = await hospitalLogin(southAccess, southRecvEmail);
      actorId = (await owner.user.findFirstOrThrow({ where: { tenantId: northTenantId } })).id;
      const southUser = await owner.user.findFirstOrThrow({ where: { tenantId: southTenantId } });
      southActorId = southUser.id;
      const southBranch = await owner.branch.findFirstOrThrow({
        where: { tenantId: southTenantId },
      });
      // Different lengths: natural order must put TESTA0999 before TESTA10000.
      await addPatient(northTenantId, northMainId, actorId, 'Qsa Short', 'USRTA0999');
      await addPatient(northTenantId, northMainId, actorId, 'Qsa Long', 'USRTA10000');
      await addPatient(northTenantId, northMainId, actorId, 'Qsa Lowest', 'USRTA0100');
      // Financial-year style (same length, plain character order).
      await addPatient(northTenantId, northMainId, actorId, 'Qsf One', '2526/00099');
      await addPatient(northTenantId, northMainId, actorId, 'Qsf Two', '2627/00006');
      await addPatient(northTenantId, northMainId, actorId, 'Qsf Three', '2627/00010');
      // Five rows for paging continuity.
      for (const n of [1, 2, 3, 4, 5]) {
        await addPatient(northTenantId, northMainId, actorId, `Qsp ${n}`, `USRTP${10 ** n}`);
      }
      // A second name group, so q can be shown to filter inside the UHID order.
      await addPatient(northTenantId, northMainId, actorId, 'Qsb Extra', 'USRTB5');
      // Another hospital with a UHID that would sort first.
      await addPatient(southTenantId, southBranch.id, southActorId, 'Qsa Other', 'USRTA99999');
    });

    it('uhid_desc puts longer UHIDs first (TESTA10000 before TESTA0999)', async () => {
      expect(await listUhids(recv, { q: 'Qsa', sort: 'uhid_desc', pageSize: 50 })).toEqual([
        'USRTA10000',
        'USRTA0999',
        'USRTA0100',
      ]);
    });

    it('uhid_asc is the exact reverse (TESTA0100, TESTA0999, TESTA10000)', async () => {
      expect(await listUhids(recv, { q: 'Qsa', sort: 'uhid_asc', pageSize: 50 })).toEqual([
        'USRTA0100',
        'USRTA0999',
        'USRTA10000',
      ]);
    });

    it('orders financial-year style UHIDs by plain character order', async () => {
      expect(await listUhids(recv, { q: 'Qsf', sort: 'uhid_asc', pageSize: 50 })).toEqual([
        '2526/00099',
        '2627/00006',
        '2627/00010',
      ]);
      expect(await listUhids(recv, { q: 'Qsf', sort: 'uhid_desc', pageSize: 50 })).toEqual([
        '2627/00010',
        '2627/00006',
        '2526/00099',
      ]);
    });

    it('works together with q (q filters, UHID order still applies)', async () => {
      expect(await listUhids(recv, { q: 'Qsb', sort: 'uhid_desc', pageSize: 50 })).toEqual([
        'USRTB5',
      ]);
      expect(await listUhids(recv, { q: 'qsa', sort: 'uhid_desc', pageSize: 50 })).toEqual([
        'USRTA10000',
        'USRTA0999',
        'USRTA0100',
      ]);
    });

    it('keeps the order across pages without gaps or repeats', async () => {
      const all = await listUhids(recv, { q: 'Qsp', sort: 'uhid_asc', pageSize: 50 });
      expect(all).toHaveLength(5);
      const paged: string[] = [];
      for (const page of [1, 2, 3]) {
        paged.push(...(await listUhids(recv, { q: 'Qsp', sort: 'uhid_asc', page, pageSize: 2 })));
      }
      expect(paged).toEqual(all);
      expect(new Set(paged).size).toBe(5);
    });

    it('does not leak another hospital into the UHID order', async () => {
      const north = await listUhids(recv, { q: 'Qsa', sort: 'uhid_desc', pageSize: 50 });
      expect(north).not.toContain('USRTA99999');
      expect(await listUhids(southTok, { q: 'Qsa', sort: 'uhid_desc', pageSize: 50 })).toEqual([
        'USRTA99999',
      ]);
    });

    it('still rejects an unknown sort value with 400', async () => {
      await request(app.getHttpServer())
        .get('/patients')
        .query({ sort: 'uhid_sideways' })
        .set('Authorization', `Bearer ${recv}`)
        .expect(400);
    });
  });

  it('form-config returns sections; fieldErrors on validation; pincode INVALID', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const cfg = await request(app.getHttpServer())
      .get('/patients/form-config')
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    const fields = cfg.body.fields as Array<{
      key?: string;
      code?: string;
      section: string;
      required: boolean;
    }>;
    expect(fields.every((f) => typeof f.section === 'string')).toBe(true);
    expect(fields.find((f) => f.key === 'name')?.section).toBe('PERSONAL');
    expect(fields.find((f) => f.key === 'phone')?.section).toBe('CONTACT');
    expect(fields.find((f) => f.key === 'phone')?.required).toBe(true);
    expect(fields.find((f) => f.key === 'date_of_birth')?.required).toBe(true);
    expect(fields.find((f) => f.code === 'title')?.section).toBe('RELATIVE');

    const both = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Both Err', dateOfBirth: '1990-01-01', ageYears: 30, phone: '9111222334' })
      .expect(400);
    expect(both.body.fieldErrors.date_of_birth).toBe('AGE_AND_DOB_BOTH');
    expect(both.body.fieldErrors.ageYears).toBe('AGE_AND_DOB_BOTH');
    expect(both.body.message).toBe('Send dateOfBirth or ageYears, not both');

    const missing = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'No Phone Age' })
      .expect(400);
    expect(missing.body.fieldErrors.phone).toBe('REQUIRED');
    expect(missing.body.fieldErrors.date_of_birth).toBe('REQUIRED');

    const badPin = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({
        name: 'Bad Pin',
        dateOfBirth: '1990-01-01',
        phone: uniqueValidTestPhone(),
        addressPincode: '12ab',
      })
      .expect(400);
    expect(badPin.body.fieldErrors.address_pincode).toBe('INVALID');

    const okPin = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({
        name: 'Good Pin',
        dateOfBirth: '1990-01-01',
        phone: uniqueValidTestPhone(),
        addressPincode: '560001',
      });
    expect([200, 201]).toContain(okPin.status);

    // Custom field with RELATIVE section already asserted via title above.
    const relative = fields.filter((f) => f.section === 'RELATIVE');
    expect(relative.some((f) => f.code === 'title')).toBe(true);
  });

  it('POST returns name REQUIRED, phone INVALID and address_pincode INVALID together', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const res = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ phone: '123', addressPincode: '560' })
      .expect(400);
    expect(res.body.fieldErrors).toMatchObject({
      name: 'REQUIRED',
      phone: 'INVALID',
      address_pincode: 'INVALID',
    });
    expect(res.body.message).toBeDefined();
  });

  it('POST returns AGE_AND_DOB_BOTH and phone INVALID together', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const res = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({
        name: 'Both And Phone',
        dateOfBirth: '1990-01-01',
        ageYears: 30,
        phone: '12',
      })
      .expect(400);
    expect(res.body.fieldErrors.date_of_birth).toBe('AGE_AND_DOB_BOTH');
    expect(res.body.fieldErrors.ageYears).toBe('AGE_AND_DOB_BOTH');
    expect(res.body.fieldErrors.phone).toBe('INVALID');
  });

  it('PATCH cannot blank name, phone, or age/date of birth; email-only PATCH still works', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({
        name: 'Patch Guard',
        dateOfBirth: '1990-01-01',
        phone: uniqueValidTestPhone(),
        email: 'patch-guard@example.test',
      });
    expect([200, 201]).toContain(created.status);
    const id = created.body.id as string;

    const blankName = await request(app.getHttpServer())
      .patch(`/patients/${id}`)
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: '' })
      .expect(400);
    expect(blankName.body.fieldErrors.name).toBe('REQUIRED');

    const blankPhone = await request(app.getHttpServer())
      .patch(`/patients/${id}`)
      .set('Authorization', `Bearer ${recv}`)
      .send({ phone: '' })
      .expect(400);
    expect(blankPhone.body.fieldErrors.phone).toBe('REQUIRED');

    const blankDob = await request(app.getHttpServer())
      .patch(`/patients/${id}`)
      .set('Authorization', `Bearer ${recv}`)
      .send({ dateOfBirth: null })
      .expect(400);
    expect(blankDob.body.fieldErrors.date_of_birth).toBe('REQUIRED');

    const emailOnly = await request(app.getHttpServer())
      .patch(`/patients/${id}`)
      .set('Authorization', `Bearer ${recv}`)
      .send({ email: 'patched-only@example.test' });
    expect([200, 201]).toContain(emailOnly.status);
    expect(emailOnly.body.id).toBe(id);

    const detail = await request(app.getHttpServer())
      .get(`/patients/${id}`)
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    expect(detail.body.email).toBe('patched-only@example.test');
    expect(detail.body.name).toBe('Patch Guard');
  });

  it('form-config sections: custom without section is OTHER; RELATIVE stays RELATIVE; built-ins use catalog defaults', async () => {
    const recv = await hospitalLogin(northAccess, northRecvEmail);
    const actor = await owner.user.findFirstOrThrow({
      where: { tenantId: northTenantId, email: northRecvEmail },
    });
    const otherField = await owner.patientCustomField.create({
      data: {
        tenantId: northTenantId,
        code: `sec_other_${Date.now()}`,
        label: 'Sectionless custom',
        dataType: 'TEXT',
      },
    });
    await owner.patientFieldSetting.create({
      data: {
        tenantId: northTenantId,
        customFieldId: otherField.id,
        isEnabled: true,
        isRequired: false,
        label: 'Sectionless custom',
        sortOrder: 200,
        changedBy: actor.id,
      },
    });
    const relativeField = await owner.patientCustomField.create({
      data: {
        tenantId: northTenantId,
        code: `sec_rel_${Date.now()}`,
        label: 'Relative custom',
        dataType: 'TEXT',
        section: 'RELATIVE',
      },
    });
    await owner.patientFieldSetting.create({
      data: {
        tenantId: northTenantId,
        customFieldId: relativeField.id,
        isEnabled: true,
        isRequired: false,
        label: 'Relative custom',
        sortOrder: 201,
        changedBy: actor.id,
      },
    });

    const cfg = await request(app.getHttpServer())
      .get('/patients/form-config')
      .set('Authorization', `Bearer ${recv}`)
      .expect(200);
    const fields = cfg.body.fields as Array<{
      key?: string;
      code?: string;
      section: string;
    }>;
    expect(fields.find((f) => f.code === otherField.code)?.section).toBe('OTHER');
    expect(fields.find((f) => f.code === relativeField.code)?.section).toBe('RELATIVE');
    expect(fields.find((f) => f.key === 'name')?.section).toBe('PERSONAL');
    expect(fields.find((f) => f.key === 'phone')?.section).toBe('CONTACT');
    expect(fields.find((f) => f.key === 'address_pincode')?.section).toBe('ADDRESS');
  });
});
