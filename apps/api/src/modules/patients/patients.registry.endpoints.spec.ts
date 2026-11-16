/**
 * Patient registry HTTP API (Phase 2 Step 3a).
 */
import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createOwnerPrisma, createPgClient, withTenant } from '../../database/db-test.util';

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
  let northTenantId: string;
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
    hqEmail = `preg_hq_${stamp}@example.test`;

    for (const code of [
      'patients.registry.read',
      'patients.registry.write',
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
          in: ['patients.registry.read', 'patients.registry.write', 'hospital.settings.write'],
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
      },
      update: {},
    });
    for (const key of ['gender', 'date_of_birth', 'phone', 'email']) {
      await owner.patientFieldCatalog.upsert({
        where: { key },
        create: {
          key,
          defaultLabel: key,
          dataType: key === 'date_of_birth' ? 'DATE' : 'TEXT',
          canDisable: true,
          alwaysRequired: false,
        },
        update: {},
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
            isRequired: c.key === 'name' ? true : c.key === 'phone' ? args.phoneRequired : false,
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

    await seedHospital({
      code: `PREG_S_${stamp}`,
      accessMain: southAccess,
      recvEmail: southRecvEmail,
      withCustomTitle: false,
      phoneRequired: true,
      uhidPrefix: 'SREG',
    });

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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
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

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Landline', phone: '02212345678' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${recv}`)
      .send({ name: 'Bad Phone', phone: '12345' })
      .expect(400);
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
});
