import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import {
  Controller,
  Get,
  ServiceUnavailableException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createOwnerPrisma } from '../../database/db-test.util';
import { AUTH_FAILED_MESSAGE } from './auth.errors';
import { AUTH_REDIS_KEY_PREFIX } from './auth.config';
import { TokenKinds } from './token-kinds.decorator';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function requireAppTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL_TEST (or DATABASE_URL) is required for auth endpoint tests');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (dbName !== 'hospigo_test') {
    throw new Error(
      `Refusing to run auth endpoint tests against database "${dbName}". Expected hospigo_test.`,
    );
  }
  return url;
}

function requireOwnerTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_OWNER_TEST || process.env.DATABASE_URL_OWNER;
  if (!url) {
    throw new Error('DATABASE_URL_OWNER_TEST is required for auth endpoint tests');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (dbName !== 'hospigo_test') {
    throw new Error(`Refusing owner fixture DB "${dbName}". Expected hospigo_test.`);
  }
  return url;
}

function hqUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_HQ;
  if (!raw) {
    throw new Error('DATABASE_URL_HQ is required for auth endpoint tests');
  }
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

function patientUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_PATIENT;
  if (!raw) {
    throw new Error('DATABASE_URL_PATIENT is required for patient auth tests');
  }
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

const appDatabaseUrl = requireAppTestDatabaseUrl();
const ownerDatabaseUrl = requireOwnerTestDatabaseUrl();

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: appDatabaseUrl,
  DATABASE_URL_OWNER: ownerDatabaseUrl,
  DATABASE_URL_HQ: hqUrlOnTestDb(),
  DATABASE_URL_PATIENT: patientUrlOnTestDb(),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  AUTH_IP_RATE_LIMIT_PER_MIN: '100',
  AUTH_LOGIN_MAX_FAILURES: '3',
  AUTH_LOGIN_FAILURE_WINDOW_MS: '600000',
  AUTH_LOGIN_LOCKOUT_MS: '600000',
  AUTH_REQUEST_BODY_LIMIT_BYTES: '2048',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] = value;
}

const TEST_PREFIX = 'hospigo:auth:test:';

@Controller('auth-kind-probe')
class AuthKindProbeController {
  @Get('hospital-only')
  @TokenKinds('HOSPITAL')
  hospitalOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('hq-only')
  @TokenKinds('HQ')
  hqOnly(): { ok: true } {
    return { ok: true };
  }
}

describe('Auth endpoints (HTTP)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('./auth-redis.service').AuthRedisService;
  let tokens: import('./token.service').TokenService;
  let accessCode: string;
  let eastAccessCode: string;
  let email: string;
  let password: string;
  let tenantId: string;
  let branchId: string;
  let eastBranchId: string;
  let userId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    accessCode = `auth-ep-${stamp}`;
    eastAccessCode = `auth-ep-east-${stamp}`;
    email = `auth_ep_${stamp}@example.test`;
    password = 'CorrectHorse9!';
    const hash = await argon2.hash(password);

    const hospital = await owner.hospital.create({
      data: {
        code: `AUTH_EP_${stamp}`,
        name: 'Auth Endpoints Hospital',
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode },
            { code: 'EAST', name: 'East', isMain: false, accessCode: eastAccessCode },
          ],
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;
    branchId = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    eastBranchId = hospital.branches.find((b) => b.code === 'EAST')!.id;

    const user = await owner.user.create({
      data: {
        tenantId,
        code: 'AUTH1',
        email,
        displayName: 'Auth User',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    userId = user.id;
    await owner.userBranch.create({
      data: { tenantId, userId, branchId },
    });
    await owner.role.create({
      data: {
        tenantId,
        code: 'STAFF',
        name: 'Staff',
        roleAssignments: {
          create: { userId, scopeType: 'HOSPITAL' },
        },
      },
    });

    const { AppModule } = await import('../../app.module');
    const { AuthRedisService } = await import('./auth-redis.service');
    const { TokenService } = await import('./token.service');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthKindProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
      bodyParser: false,
    });
    const nestApp = app as NestExpressApplication;
    nestApp.useBodyParser('json', { limit: 2048 });
    nestApp.useBodyParser('urlencoded', { limit: 2048, extended: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    redis = app.get(AuthRedisService);
    tokens = app.get(TokenService);
    redis.setKeyPrefix(TEST_PREFIX);
    await redis.clearPrefixKeys();
  });

  afterEach(async () => {
    await redis.clearPrefixKeys();
  });

  afterAll(async () => {
    redis.setKeyPrefix(AUTH_REDIS_KEY_PREFIX);
    await app.close();
    await owner.$disconnect();
  });

  function expectGeneric401(res: request.Response): void {
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      message: AUTH_FAILED_MESSAGE,
    });
  }

  it('rejects every hospital login failure type with identical status and body', async () => {
    const disabledEmail = `disabled_${Date.now()}@example.test`;
    const hash = await argon2.hash(password);
    const disabled = await owner.user.create({
      data: {
        tenantId,
        code: `DIS${Date.now()}`,
        email: disabledEmail,
        displayName: 'Disabled',
        passwordHash: hash,
        isActive: false,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.create({
      data: { tenantId, userId: disabled.id, branchId },
    });

    const inactiveCode = `inactive-br-${Date.now()}`;
    await owner.branch.create({
      data: {
        tenantId,
        code: 'WEST',
        name: 'West',
        isMain: false,
        accessCode: inactiveCode,
        isActive: false,
      },
    });

    const cases = [
      { accessCode: 'no-such-code-zzzz', email, password },
      { accessCode: inactiveCode, email, password },
      { accessCode, email: 'missing@example.test', password },
      { accessCode, email, password: 'WrongPassword9!' },
      { accessCode, email: disabledEmail, password },
      { accessCode: eastAccessCode, email, password },
    ];
    const bodies: string[] = [];
    for (const body of cases) {
      const res = await request(app.getHttpServer()).post('/auth/hospital/login').send(body);
      expectGeneric401(res);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('locks account after configured failures with generic 401; clear prefix simulates expiry', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/auth/hospital/login')
        .send({ accessCode, email, password: 'WrongPassword9!' });
      expectGeneric401(res);
    }
    const locked = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expectGeneric401(locked);

    const lockAudits = await owner.auditLog.findMany({
      where: { tenantId, action: 'AUTH_LOCKOUT' },
      take: 1,
      orderBy: { createdAt: 'desc' },
    });
    expect(lockAudits.length).toBeGreaterThan(0);

    await redis.clearPrefixKeys();
    const ok = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeDefined();
    expect(ok.body.refreshToken).toBeDefined();
    expect(ok.body.mustChangePassword).toBe(false);
  });

  it('returns 429 when IP rate limit is exceeded', async () => {
    const authCfg = (redis as unknown as { auth: { ipRateLimitPerMinute: number } }).auth;
    const prev = authCfg.ipRateLimitPerMinute;
    authCfg.ipRateLimitPerMinute = 2;
    await redis.clearPrefixKeys();
    await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password: 'WrongPassword9!' });
    await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password: 'WrongPassword9!' });
    const limited = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password: 'WrongPassword9!' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    authCfg.ipRateLimitPerMinute = prev;
  });

  it('refuses login when Redis is unavailable (fail-closed)', async () => {
    const spy = jest
      .spyOn(redis, 'assertIpAllowed')
      .mockRejectedValue(new ServiceUnavailableException('Authentication temporarily unavailable'));
    const res = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expect(res.status).toBe(503);
    spy.mockRestore();
  });

  it('login/refresh/me/logout and refresh rotation + reuse revoke family', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expect(login.status).toBe(200);
    const { accessToken, refreshToken } = login.body;

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      id: userId,
      email,
      kind: 'HOSPITAL',
      hospitalName: 'Auth Endpoints Hospital',
      activeBranchId: branchId,
      mustChangePassword: false,
    });
    expect(me.body.passwordHash).toBeUndefined();
    expect(me.body.accessToken).toBeUndefined();

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).toBeDefined();
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    const reuse = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });
    expectGeneric401(reuse);

    const reuseAudits = await owner.auditLog.findMany({
      where: { tenantId, action: 'AUTH_REFRESH_REUSE' },
      take: 1,
    });
    expect(reuseAudits.length).toBeGreaterThan(0);

    const login2 = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    const rt = login2.body.refreshToken as string;
    const logout = await request(app.getHttpServer()).post('/auth/logout').send({
      refreshToken: rt,
    });
    expect(logout.status).toBe(200);
    const afterLogout = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rt });
    expectGeneric401(afterLogout);
  });

  it('refresh fails after branch membership is removed', async () => {
    await owner.userBranch.create({
      data: { tenantId, userId, branchId: eastBranchId },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: eastAccessCode, email, password });
    expect(login.status).toBe(200);
    const refreshToken = login.body.refreshToken as string;

    await owner.userBranch.updateMany({
      where: { userId, branchId: eastBranchId },
      data: { isActive: false },
    });

    const refresh = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });
    expectGeneric401(refresh);
  });

  it('CHANGE_PASSWORD token is refused on /auth/me and accepted on change-password', async () => {
    const stamp = Date.now();
    const code = `mcp-${stamp}`;
    const mcpEmail = `mcp_${stamp}@example.test`;
    const hash = await argon2.hash(password);
    const h = await owner.hospital.create({
      data: {
        code: `MCP_${stamp}`,
        name: 'MCP Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: code },
        },
      },
      include: { branches: true },
    });
    const u = await owner.user.create({
      data: {
        tenantId: h.id,
        code: 'MCP1',
        email: mcpEmail,
        displayName: 'MCP',
        passwordHash: hash,
        mustChangePassword: true,
      },
    });
    await owner.userBranch.create({
      data: { tenantId: h.id, userId: u.id, branchId: h.branches[0]!.id },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: code, email: mcpEmail, password });
    expect(login.status).toBe(200);
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.body.mustChangePassword).toBe(true);

    const denied = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(denied.status).toBe(401);

    const changed = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: password, newPassword: 'BrandNewPass9!' });
    expect(changed.status).toBe(200);
    expect(changed.body.refreshToken).toBeDefined();
    expect(changed.body.mustChangePassword).toBe(false);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${changed.body.accessToken}`);
    expect(me.status).toBe(200);

    const pwAudits = await owner.auditLog.findMany({
      where: { tenantId: h.id, action: 'AUTH_PASSWORD_CHANGE' },
      take: 1,
    });
    expect(pwAudits.length).toBeGreaterThan(0);
    const meta = JSON.stringify(pwAudits[0]!.metadata ?? {});
    expect(meta).not.toContain('BrandNewPass9!');
  });

  it('HQ token refused on hospital route and reverse (HTTP)', async () => {
    const hospitalTok = tokens.signHospitalAccess({
      tenantId,
      userId,
      branchId,
    });
    const hqTok = tokens.signHqAccess({ userId: 'hq-probe-user' });

    const hqOnHospital = await request(app.getHttpServer())
      .get('/auth-kind-probe/hospital-only')
      .set('Authorization', `Bearer ${hqTok}`);
    expect(hqOnHospital.status).toBe(401);

    const hospitalOnHq = await request(app.getHttpServer())
      .get('/auth-kind-probe/hq-only')
      .set('Authorization', `Bearer ${hospitalTok}`);
    expect(hospitalOnHq.status).toBe(401);

    const hospitalOk = await request(app.getHttpServer())
      .get('/auth-kind-probe/hospital-only')
      .set('Authorization', `Bearer ${hospitalTok}`);
    expect(hospitalOk.status).toBe(200);
  });

  it('global guard: unmarked route without token is 401; health stays public', async () => {
    const denied = await request(app.getHttpServer()).get('/auth/me');
    expect(denied.status).toBe(401);

    const health = await request(app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);
  });

  it('validation rejects unknown fields and oversized bodies', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password, extraField: true });
    expect(unknown.status).toBe(400);

    const oversized = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .set('Content-Type', 'application/json')
      .send(`{"accessCode":"${'x'.repeat(3000)}","email":"a@b.co","password":"y"}`);
    expect([400, 413]).toContain(oversized.status);
  });

  it('writes audit row on login success without secrets', async () => {
    await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    const audits = await owner.auditLog.findMany({
      where: { tenantId, action: 'AUTH_LOGIN_SUCCESS' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(audits.length).toBeGreaterThan(0);
    const meta = JSON.stringify(audits[0]!.metadata ?? {});
    expect(meta).not.toContain(password);
    expect(meta.toLowerCase()).not.toContain('bearer');
    expect(meta).not.toMatch(/@example\.test/);
  });

  it('after change-password, pre-change refresh token fails and new tokens work', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expect(login.status).toBe(200);
    const oldRefresh = login.body.refreshToken as string;
    const access = login.body.accessToken as string;

    const changed = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: password, newPassword: 'PostChangePass9!' });
    expect(changed.status).toBe(200);
    expect(changed.body.refreshToken).toBeDefined();

    const oldFails = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh });
    expectGeneric401(oldFails);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${changed.body.accessToken}`);
    expect(me.status).toBe(200);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: changed.body.refreshToken });
    expect(refreshed.status).toBe(200);

    // Restore password for later tests in this suite.
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .send({ currentPassword: 'PostChangePass9!', newPassword: password });
  });

  it('refresh fails after user is deactivated', async () => {
    const stamp = Date.now();
    const code = `rf-user-${stamp}`;
    const uEmail = `rf_user_${stamp}@example.test`;
    const hash = await argon2.hash(password);
    const h = await owner.hospital.create({
      data: {
        code: `RFU_${stamp}`,
        name: 'RF User Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: code },
        },
      },
      include: { branches: true },
    });
    const u = await owner.user.create({
      data: {
        tenantId: h.id,
        code: 'RFU1',
        email: uEmail,
        displayName: 'RF User',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.create({
      data: { tenantId: h.id, userId: u.id, branchId: h.branches[0]!.id },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: code, email: uEmail, password });
    expect(login.status).toBe(200);
    await owner.user.update({ where: { id: u.id }, data: { isActive: false } });
    const refresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expectGeneric401(refresh);
  });

  it('refresh fails after branch is deactivated', async () => {
    const stamp = Date.now();
    const code = `rf-br-${stamp}`;
    const uEmail = `rf_br_${stamp}@example.test`;
    const hash = await argon2.hash(password);
    const h = await owner.hospital.create({
      data: {
        code: `RFB_${stamp}`,
        name: 'RF Branch Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: code },
        },
      },
      include: { branches: true },
    });
    const branch = h.branches[0]!;
    const u = await owner.user.create({
      data: {
        tenantId: h.id,
        code: 'RFB1',
        email: uEmail,
        displayName: 'RF Branch',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.create({
      data: { tenantId: h.id, userId: u.id, branchId: branch.id },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: code, email: uEmail, password });
    expect(login.status).toBe(200);
    await owner.branch.update({ where: { id: branch.id }, data: { isActive: false } });
    const refresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expectGeneric401(refresh);
  });

  it('refresh fails after hospital is deactivated', async () => {
    const stamp = Date.now();
    const code = `rf-hos-${stamp}`;
    const uEmail = `rf_hos_${stamp}@example.test`;
    const hash = await argon2.hash(password);
    const h = await owner.hospital.create({
      data: {
        code: `RFH_${stamp}`,
        name: 'RF Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: code },
        },
      },
      include: { branches: true },
    });
    const u = await owner.user.create({
      data: {
        tenantId: h.id,
        code: 'RFH1',
        email: uEmail,
        displayName: 'RF Hos',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.create({
      data: { tenantId: h.id, userId: u.id, branchId: h.branches[0]!.id },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode: code, email: uEmail, password });
    expect(login.status).toBe(200);
    await owner.hospital.update({
      where: { id: h.id },
      data: { isActive: false, status: 'INACTIVE' },
    });
    const refresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expectGeneric401(refresh);
  });

  it('login lockout Redis fail and lock key TTLs match configured windows', async () => {
    const authCfg = (
      redis as unknown as {
        auth: { loginMaxFailures: number; loginFailureWindowMs: number; loginLockoutMs: number };
      }
    ).auth;
    await redis.clearPrefixKeys();

    const accountHash = redis.accountKeyMaterial(accessCode, email);
    await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password: 'WrongPassword9!' });
    const afterOne = await redis.getFailLockTtlMs(accountHash, 'login');
    expect(afterOne.failMs).toBeGreaterThan(authCfg.loginFailureWindowMs - 5_000);
    expect(afterOne.failMs).toBeLessThanOrEqual(authCfg.loginFailureWindowMs);
    expect(afterOne.lockMs).toBe(-2);

    for (let i = 1; i < authCfg.loginMaxFailures; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/hospital/login')
        .send({ accessCode, email, password: 'WrongPassword9!' });
    }
    const afterLock = await redis.getFailLockTtlMs(accountHash, 'login');
    expect(afterLock.failMs).toBe(-2);
    expect(afterLock.lockMs).toBeGreaterThan(authCfg.loginLockoutMs - 5_000);
    expect(afterLock.lockMs).toBeLessThanOrEqual(authCfg.loginLockoutMs);
  });

  it('HQ login wrong password and unknown email return identical generic 401', async () => {
    const stamp = Date.now();
    const hqEmail = `hq_login_${stamp}@example.test`;
    const hash = await argon2.hash(password);
    await owner.hqUser.create({
      data: {
        email: hqEmail,
        displayName: 'HQ Login',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });

    const wrong = await request(app.getHttpServer())
      .post('/auth/hq/login')
      .send({ email: hqEmail, password: 'WrongPassword9!' });
    const unknown = await request(app.getHttpServer())
      .post('/auth/hq/login')
      .send({ email: `missing_hq_${stamp}@example.test`, password });
    expectGeneric401(wrong);
    expectGeneric401(unknown);
    expect(JSON.stringify(wrong.body)).toBe(JSON.stringify(unknown.body));
  });

  it('HQ login lockout triggers after configured failures and stays generic', async () => {
    const stamp = Date.now();
    const hqEmail = `hq_lock_${stamp}@example.test`;
    const hash = await argon2.hash(password);
    await owner.hqUser.create({
      data: {
        email: hqEmail,
        displayName: 'HQ Lock',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    const authCfg = (redis as unknown as { auth: { loginMaxFailures: number } }).auth;
    await redis.clearPrefixKeys();

    for (let i = 0; i < authCfg.loginMaxFailures; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/auth/hq/login')
        .send({ email: hqEmail, password: 'WrongPassword9!' });
      expectGeneric401(res);
    }
    const locked = await request(app.getHttpServer())
      .post('/auth/hq/login')
      .send({ email: hqEmail, password });
    expectGeneric401(locked);
  });

  it('change-password lockout: wrong current password N times locks; correct during lock is still 401', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expect(login.status).toBe(200);
    const access = login.body.accessToken as string;
    const authCfg = (redis as unknown as { auth: { loginMaxFailures: number } }).auth;
    await redis.clearPrefixKeys();

    for (let i = 0; i < authCfg.loginMaxFailures; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: 'WrongPassword9!', newPassword: 'AnotherValid9!' });
      expectGeneric401(res);
    }
    const stillLocked = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: password, newPassword: 'AnotherValid9!' });
    expectGeneric401(stillLocked);

    const lockAudits = await owner.auditLog.findMany({
      where: { tenantId, action: 'AUTH_LOCKOUT' },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    expect(
      lockAudits.some((a) => JSON.stringify(a.metadata ?? {}).includes('change-password')),
    ).toBe(true);
  });

  it('change-password applies IP rate limit with 429', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password });
    expect(login.status).toBe(200);
    const access = login.body.accessToken as string;
    const authCfg = (redis as unknown as { auth: { ipRateLimitPerMinute: number } }).auth;
    const prev = authCfg.ipRateLimitPerMinute;
    authCfg.ipRateLimitPerMinute = 2;
    await redis.clearPrefixKeys();

    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'WrongPassword9!', newPassword: 'AnotherValid9!' });
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'WrongPassword9!', newPassword: 'AnotherValid9!' });
    const limited = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'WrongPassword9!', newPassword: 'AnotherValid9!' });
    expect(limited.status).toBe(429);
    authCfg.ipRateLimitPerMinute = prev;
  });
});
