/**
 * PermissionGuard HTTP behaviour (after AuthGuard).
 */
import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { Controller, Get, Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createOwnerPrisma } from '../../database/db-test.util';
import { AuthenticatedOnly, RequirePermission } from './permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';

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

function hqUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_HQ;
  if (!raw) throw new Error('DATABASE_URL_HQ required');
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

function patientUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_PATIENT;
  if (!raw) throw new Error('DATABASE_URL_PATIENT required');
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
  DATABASE_URL_PATIENT: patientUrlOnTestDb(),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  AUTH_IP_RATE_LIMIT_PER_MIN: '100',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
});

@Controller('perm-probe')
@TokenKinds('HOSPITAL')
class PermProbeController {
  @Get('needs-read')
  @RequirePermission('patients.registry.read', { module: 'OPD' })
  needsRead(): { ok: true } {
    return { ok: true };
  }

  @Get('authed')
  @AuthenticatedOnly()
  authed(): { ok: true } {
    return { ok: true };
  }

  @Get('undeclared')
  undeclared(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [PermProbeController] })
class PermProbeModule {}

const TEST_PREFIX = 'hospigo:perm:guard:';

describe('PermissionGuard (HTTP)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('../auth/auth-redis.service').AuthRedisService;
  let accessCode: string;
  let password: string;
  let withPermEmail: string;
  let withoutPermEmail: string;
  let tenantId: string;
  let branchId: string;
  let moduleOpdId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    password = 'CorrectHorse9!';
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    accessCode = `perm-g-${stamp}`;
    withPermEmail = `perm_ok_${stamp}@example.test`;
    withoutPermEmail = `perm_no_${stamp}@example.test`;

    for (const code of ['patients.registry.read', 'patients.registry.write']) {
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
    moduleOpdId = opd.id;

    const hospital = await owner.hospital.create({
      data: {
        code: `PERM_G_${stamp}`,
        name: 'Perm Guard Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode },
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;
    branchId = hospital.branches[0]!.id;

    await owner.hospitalModuleSubscription.create({
      data: { tenantId, moduleId: moduleOpdId },
    });
    await owner.branchModule.create({
      data: {
        tenantId,
        branchId,
        moduleId: moduleOpdId,
        enabledByIndigo: true,
        restrictedByHospital: false,
        isActive: true,
      },
    });

    const readPerm = await owner.permission.findUniqueOrThrow({
      where: { code: 'patients.registry.read' },
    });

    const roleOk = await owner.role.create({
      data: { tenantId, code: 'RECV', name: 'Recv' },
    });
    await owner.rolePermission.create({
      data: { tenantId, roleId: roleOk.id, permissionId: readPerm.id },
    });
    const roleNo = await owner.role.create({
      data: { tenantId, code: 'NONE', name: 'None' },
    });

    const userOk = await owner.user.create({
      data: {
        tenantId,
        code: 'OK1',
        email: withPermEmail,
        displayName: 'Ok',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    const userNo = await owner.user.create({
      data: {
        tenantId,
        code: 'NO1',
        email: withoutPermEmail,
        displayName: 'No',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.createMany({
      data: [
        { tenantId, userId: userOk.id, branchId },
        { tenantId, userId: userNo.id, branchId },
      ],
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: userOk.id,
        roleId: roleOk.id,
        scopeType: 'HOSPITAL',
      },
    });
    await owner.roleAssignment.create({
      data: {
        tenantId,
        userId: userNo.id,
        roleId: roleNo.id,
        scopeType: 'HOSPITAL',
      },
    });

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, PermProbeModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    redis = app.get((await import('../auth/auth-redis.service')).AuthRedisService);
    redis.setKeyPrefix(TEST_PREFIX);
  }, 120_000);

  afterAll(async () => {
    await redis?.clearPrefixKeys();
    await app?.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await redis.clearPrefixKeys();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  it('RequirePermission refused without permission, allowed with it', async () => {
    const noTok = await login(withoutPermEmail);
    await request(app.getHttpServer())
      .get('/perm-probe/needs-read')
      .set('Authorization', `Bearer ${noTok}`)
      .expect(403)
      .expect({ statusCode: 403, message: 'Forbidden', error: 'Forbidden' });

    const okTok = await login(withPermEmail);
    await request(app.getHttpServer())
      .get('/perm-probe/needs-read')
      .set('Authorization', `Bearer ${okTok}`)
      .expect(200)
      .expect({ ok: true });
  });

  it('disabled module refuses a route that names the module', async () => {
    await owner.branchModule.update({
      where: {
        tenantId_branchId_moduleId: {
          tenantId,
          branchId,
          moduleId: moduleOpdId,
        },
      },
      data: { isActive: false },
    });
    const okTok = await login(withPermEmail);
    await request(app.getHttpServer())
      .get('/perm-probe/needs-read')
      .set('Authorization', `Bearer ${okTok}`)
      .expect(403);
    await owner.branchModule.update({
      where: {
        tenantId_branchId_moduleId: {
          tenantId,
          branchId,
          moduleId: moduleOpdId,
        },
      },
      data: { isActive: true },
    });
  });

  it('undeclared route is denied', async () => {
    const okTok = await login(withPermEmail);
    await request(app.getHttpServer())
      .get('/perm-probe/undeclared')
      .set('Authorization', `Bearer ${okTok}`)
      .expect(403);
  });

  it('AuthenticatedOnly allows signed-in hospital user', async () => {
    const okTok = await login(withPermEmail);
    await request(app.getHttpServer())
      .get('/perm-probe/authed')
      .set('Authorization', `Bearer ${okTok}`)
      .expect(200);
  });
});
