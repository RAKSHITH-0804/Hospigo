/**
 * GET /auth/me shell fields: branches + enabled modules (Step 7 exit demo).
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
import { createOwnerPrisma } from '../../database/db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function requireAppTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL_TEST required');
  }
  if (new URL(url).pathname.replace(/^\//, '') !== 'hospigo_test') {
    throw new Error('Expected hospigo_test');
  }
  return url;
}

function requireOwnerTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_OWNER_TEST || process.env.DATABASE_URL_OWNER;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER_TEST required');
  }
  if (new URL(url).pathname.replace(/^\//, '') !== 'hospigo_test') {
    throw new Error('Expected hospigo_test');
  }
  return url;
}

function hqUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_HQ;
  if (!raw) {
    throw new Error('DATABASE_URL_HQ required');
  }
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
  DATABASE_URL_HQ: hqUrlOnTestDb(),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  AUTH_IP_RATE_LIMIT_PER_MIN: '100',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
});

const TEST_PREFIX = 'hospigo:auth:me:shell:';

describe('GET /auth/me shell fields (HTTP)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('./auth-redis.service').AuthRedisService;
  let password: string;
  let north: {
    accessCode: string;
    email: string;
    tenantId: string;
    branchName: string;
    enabledCodes: string[];
  };
  let south: {
    accessCode: string;
    email: string;
    tenantId: string;
    branchName: string;
    enabledCodes: string[];
  };
  let disabledModuleCode: string;

  beforeAll(async () => {
    const stamp = Date.now();
    password = 'CorrectHorse9!';
    const hash = await argon2.hash(password, { type: argon2.argon2id });

    const modules = await owner.module.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    if (modules.length < 3) {
      throw new Error('Need reference modules seeded in hospigo_test');
    }
    const northCodes = [modules[0]!.code, modules[1]!.code];
    const southCodes = [modules[0]!.code, modules[2]!.code];
    disabledModuleCode = modules.find((m) => !northCodes.includes(m.code))!.code;

    async function seedHospital(
      code: string,
      name: string,
      accessCode: string,
      email: string,
      enabledCodes: string[],
    ) {
      const hospital = await owner.hospital.create({
        data: {
          code,
          name,
          isTest: true,
          status: 'ACTIVE',
          branches: {
            create: { code: 'MAIN', name: `${name} Main`, isMain: true, accessCode },
          },
        },
        include: { branches: true },
      });
      const branchId = hospital.branches[0]!.id;
      const user = await owner.user.create({
        data: {
          tenantId: hospital.id,
          code: `U${stamp}${code.slice(-4)}`,
          email,
          displayName: name,
          passwordHash: hash,
          mustChangePassword: false,
          isActive: true,
        },
      });
      await owner.userBranch.create({
        data: { tenantId: hospital.id, userId: user.id, branchId, isActive: true },
      });
      await owner.role.create({
        data: {
          tenantId: hospital.id,
          code: 'STAFF',
          name: 'Staff',
          roleAssignments: { create: { userId: user.id, scopeType: 'HOSPITAL' } },
        },
      });

      for (const mod of modules) {
        const enabled = enabledCodes.includes(mod.code);
        await owner.hospitalModuleSubscription.create({
          data: {
            tenantId: hospital.id,
            moduleId: mod.id,
            isActive: enabled,
          },
        });
        await owner.branchModule.create({
          data: {
            tenantId: hospital.id,
            branchId,
            moduleId: mod.id,
            enabledByIndigo: enabled,
            restrictedByHospital: false,
            isActive: enabled,
          },
        });
      }

      return {
        accessCode,
        email,
        tenantId: hospital.id,
        branchName: `${name} Main`,
        enabledCodes,
      };
    }

    north = await seedHospital(
      `ME_N_${stamp}`,
      'Me North Hospital',
      `me-north-${stamp}`,
      `me_north_${stamp}@example.test`,
      northCodes,
    );
    south = await seedHospital(
      `ME_S_${stamp}`,
      'Me South Hospital',
      `me-south-${stamp}`,
      `me_south_${stamp}@example.test`,
      southCodes,
    );

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    redis = app.get((await import('./auth-redis.service')).AuthRedisService);
    redis.setKeyPrefix(TEST_PREFIX);
  }, 120_000);

  afterAll(async () => {
    await redis?.clearPrefixKeys();
    await app?.close();
    for (const tenantId of [north?.tenantId, south?.tenantId].filter(Boolean)) {
      await owner.branchModule.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await owner.hospitalModuleSubscription
        .deleteMany({ where: { tenantId } })
        .catch(() => undefined);
      await owner.roleAssignment.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await owner.role.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await owner.userBranch.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await owner.branch.deleteMany({ where: { tenantId } }).catch(() => undefined);
      await owner.hospital.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    }
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await redis.clearPrefixKeys();
  });

  async function loginMe(accessCode: string, email: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password })
      .expect(200);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    return { token: login.body.accessToken as string, me: me.body };
  }

  it('two hospitals return different hospital, branch, and module lists', async () => {
    const a = await loginMe(north.accessCode, north.email);
    const b = await loginMe(south.accessCode, south.email);

    expect(a.me.hospitalName).toBe('Me North Hospital');
    expect(b.me.hospitalName).toBe('Me South Hospital');
    expect(a.me.activeBranchName).toBe(north.branchName);
    expect(b.me.activeBranchName).toBe(south.branchName);
    expect(a.me.hospitalName).not.toBe(b.me.hospitalName);

    const aCodes = (a.me.enabledModules as Array<{ code: string }>).map((m) => m.code).sort();
    const bCodes = (b.me.enabledModules as Array<{ code: string }>).map((m) => m.code).sort();
    expect(aCodes).not.toEqual(bCodes);
    expect(aCodes).toContain(north.enabledCodes[0]);
    expect(bCodes).toContain(south.enabledCodes[1]);

    expect(a.me.branches).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: north.branchName, isMain: true })]),
    );
  });

  it('disabled module is absent from enabledModules', async () => {
    const a = await loginMe(north.accessCode, north.email);
    const codes = (a.me.enabledModules as Array<{ code: string }>).map((m) => m.code);
    expect(codes).not.toContain(disabledModuleCode);
  });

  it('hospital A token cannot see hospital B tenant fields on /auth/me', async () => {
    const a = await loginMe(north.accessCode, north.email);
    expect(a.me.hospitalName).toBe('Me North Hospital');
    expect(JSON.stringify(a.me)).not.toContain('Me South Hospital');
    expect(JSON.stringify(a.me)).not.toContain(south.tenantId);
  });

  it('end-to-end: two logins differ on me; north token cannot read south tenant id', async () => {
    const northLogin = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: north.accessCode, email: north.email, password })
      .expect(200);
    const southLogin = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: south.accessCode, email: south.email, password })
      .expect(200);

    const northMe = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${northLogin.body.accessToken}`)
      .expect(200);
    const southMe = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${southLogin.body.accessToken}`)
      .expect(200);

    expect(northMe.body.hospitalName).not.toBe(southMe.body.hospitalName);
    expect(northMe.body.activeBranchName).not.toBe(southMe.body.activeBranchName);
    const northCodes = (northMe.body.enabledModules as Array<{ code: string }>).map((m) => m.code);
    const southCodes = (southMe.body.enabledModules as Array<{ code: string }>).map((m) => m.code);
    expect(northCodes.sort()).not.toEqual(southCodes.sort());

    const serialized = JSON.stringify(northMe.body);
    expect(serialized).not.toContain(south.tenantId);
    expect(serialized).not.toContain(southMe.body.hospitalName);
    expect(serialized).not.toContain(southMe.body.id);
  });
});
