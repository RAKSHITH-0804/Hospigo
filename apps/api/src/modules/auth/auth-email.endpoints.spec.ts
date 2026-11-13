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
import { AuthActionPurpose } from '../../generated/prisma';
import { MailProcessor } from '../mail/mail.processor';
import { MailService } from '../mail/mail.service';
import type { MailJobData } from '../mail/mail.types';
import { ActionTokenService } from './action-token.service';
import { AuthEmailService } from './auth-email.service';
import { AuthRedisService } from './auth-redis.service';
import { loadAuthConfig } from './auth.config';

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

function patientUrlOnTestDb(): string {
  const raw = process.env.DATABASE_URL_PATIENT;
  if (!raw) {
    throw new Error('DATABASE_URL_PATIENT required');
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
  DATABASE_URL_PATIENT: patientUrlOnTestDb(),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  AUTH_IP_RATE_LIMIT_PER_MIN: '100',
  AUTH_FORGOT_PASSWORD_MIN_RESPONSE_MS: '40',
  AUTH_RESET_MAX_REQUESTS_PER_WINDOW: '3',
  AUTH_RESET_REQUEST_WINDOW_MS: '60000',
  APP_URL: 'http://127.0.0.1:3001',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
});

const TEST_PREFIX = 'hospigo:auth:email:test:';
const INVALID = {
  statusCode: 400,
  message: 'Invalid or expired link',
  error: 'Bad Request',
};

describe('Auth email flows (HTTP)', () => {
  const owner = createOwnerPrisma();
  const mailJobs: MailJobData[] = [];
  let app: INestApplication;
  let redis: AuthRedisService;
  let actionTokens: ActionTokenService;
  let authEmail: AuthEmailService;
  let accessCode: string;
  let email: string;
  let password: string;
  let tenantId: string;
  let branchId: string;
  let userId: string;
  let hqEmail: string;
  let hqUserId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    accessCode = `auth-mail-${stamp}`;
    email = `auth_mail_${stamp}@example.test`;
    password = 'CorrectHorse9!';
    hqEmail = `hq_mail_${stamp}@example.test`;

    const hospital = await owner.hospital.create({
      data: {
        code: `HM${stamp}`,
        name: 'Mail Test Hospital',
        status: 'ACTIVE',
        isActive: true,
        isTest: true,
      },
    });
    tenantId = hospital.id;
    const branch = await owner.branch.create({
      data: {
        tenantId,
        code: 'MAIN',
        name: 'Main',
        accessCode,
        isMain: true,
        isActive: true,
      },
    });
    branchId = branch.id;
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await owner.user.create({
      data: {
        tenantId,
        code: `U${stamp}`,
        email,
        displayName: 'Mail User',
        passwordHash: hash,
        mustChangePassword: true,
        isActive: true,
      },
    });
    userId = user.id;
    await owner.userBranch.create({
      data: { tenantId, userId, branchId, isActive: true },
    });

    const hqHash = await argon2.hash(password, { type: argon2.argon2id });
    const hq = await owner.hqUser.create({
      data: {
        email: hqEmail,
        displayName: 'HQ Mail',
        passwordHash: hqHash,
        mustChangePassword: true,
        isActive: true,
      },
    });
    hqUserId = hq.id;

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({
        enqueue: async (data: MailJobData) => {
          mailJobs.push({ ...data });
        },
        onModuleDestroy: async () => undefined,
      })
      .overrideProvider(MailProcessor)
      .useValue({
        onModuleInit: () => undefined,
        onModuleDestroy: async () => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    redis = app.get(AuthRedisService);
    redis.setKeyPrefix(TEST_PREFIX);
    actionTokens = app.get(ActionTokenService);
    authEmail = app.get(AuthEmailService);
  }, 120_000);

  afterAll(async () => {
    await redis?.clearPrefixKeys();
    await app?.close();
    await owner.hqAuthActionToken.deleteMany({ where: { hqUserId } }).catch(() => undefined);
    await owner.hqAuthSession.deleteMany({ where: { userId: hqUserId } }).catch(() => undefined);
    await owner.hqUser.deleteMany({ where: { id: hqUserId } }).catch(() => undefined);
    await owner.authActionToken.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await owner.authSession.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await owner.userBranch.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await owner.user.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await owner.branch.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await owner.hospital.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    mailJobs.length = 0;
    await redis.clearPrefixKeys();
  });

  it('forgot-password returns identical 202 and enqueues only for valid users', async () => {
    const known = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ accessCode, email })
      .expect(202);
    const unknown = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ accessCode, email: 'missing@example.test' })
      .expect(202);
    const badCode = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ accessCode: 'no-such-code', email })
      .expect(202);
    expect(known.body).toEqual({ accepted: true });
    expect(unknown.body).toEqual({ accepted: true });
    expect(badCode.body).toEqual({ accepted: true });
    expect(mailJobs).toHaveLength(1);
    expect(mailJobs[0]).toEqual({
      kind: 'PASSWORD_RESET',
      tenantId,
      userId,
    });
    const blob = JSON.stringify(mailJobs[0]);
    expect(blob).not.toContain(email);
    expect(blob.toLowerCase()).not.toContain('secret');
    expect(blob).not.toMatch(/h\.|q\./);
  });

  it('forgot-password timing pad respects config min response ms', async () => {
    const cfg = loadAuthConfig(process.env);
    const started = Date.now();
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ accessCode: 'pad-miss', email: 'pad@example.test' })
      .expect(202);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(cfg.forgotPasswordMinResponseMs - 5);
  });

  it('forgot-password account rate limit triggers', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ accessCode, email })
        .expect(202);
    }
    const limited = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ accessCode, email })
      .expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('token lifecycle: reset once; reused/malformed/wrong-secret share identical 400', async () => {
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 'test-req',
    });
    const parsed = actionTokens.parseToken(rawToken);
    expect(parsed?.kind).toBe('hospital');
    const wrongSecret =
      parsed && parsed.kind === 'hospital'
        ? `h.${parsed.tenantId}.${parsed.tokenId}.wrongsecretvalue000000000000000000`
        : 'h.x.y.z';

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BrandNewPass1!' })
      .expect(204);

    const second = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BrandNewPass2!' })
      .expect(400);
    expect(second.body).toEqual(INVALID);

    for (const bad of ['not-a-token', 'h.x.y.z', 'q.onlytwo', wrongSecret, 'h.bad.secret.wrong']) {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: bad, newPassword: 'BrandNewPass3!' })
        .expect(400);
      expect(res.body).toEqual(INVALID);
    }
  });

  it('expired token returns identical generic 400', async () => {
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 'expired',
    });
    const parsed = actionTokens.parseToken(rawToken);
    expect(parsed?.kind).toBe('hospital');
    if (!parsed || parsed.kind !== 'hospital') {
      throw new Error('expected hospital token');
    }
    await owner.authActionToken.update({
      where: { id: parsed.tokenId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'ExpiredLink9!' })
      .expect(400);
    expect(res.body).toEqual(INVALID);
  });

  it('weak password does not consume token', async () => {
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 'test-weak',
    });
    const weak = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'short' })
      .expect(400);
    expect(weak.body.message).toMatch(/Password rejected/);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'StrongEnough9!' })
      .expect(204);
  });

  it('new token invalidates previous unused token', async () => {
    const first = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 't1',
    });
    const second = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 't2',
    });
    const old = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: first.rawToken, newPassword: 'AnotherGood9!' })
      .expect(400);
    expect(old.body).toEqual(INVALID);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: second.rawToken, newPassword: 'AnotherGood9!' })
      .expect(204);
  });

  it('activation: weak password does not consume token', async () => {
    await owner.user.update({
      where: { id: userId },
      data: { mustChangePassword: true, isActive: true },
    });
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.ACTIVATION,
      requestId: 'act-weak',
    });
    const weak = await request(app.getHttpServer())
      .post('/auth/activate')
      .send({ token: rawToken, newPassword: 'short' })
      .expect(400);
    expect(weak.body.message).toMatch(/Password rejected/);

    await request(app.getHttpServer())
      .post('/auth/activate')
      .send({ token: rawToken, newPassword: 'ActivatedPass9!' })
      .expect(204);
  });

  it('activation clears must_change_password for hospital users', async () => {
    await owner.user.update({
      where: { id: userId },
      data: { mustChangePassword: true },
    });
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.ACTIVATION,
      requestId: 'act',
    });
    await request(app.getHttpServer())
      .post('/auth/activate')
      .send({ token: rawToken, newPassword: 'ActivatedPass9!' })
      .expect(204);
    const user = await owner.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mustChangePassword).toBe(false);
    expect(user.passwordChangedAt).toBeTruthy();
  });

  it('reset revokes all hospital sessions', async () => {
    const session = await owner.authSession.create({
      data: {
        tenantId,
        userId,
        branchId,
        tokenHash: `pre-reset-hash-${Date.now()}`,
        familyId: `pre-reset-family-${Date.now()}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 'revoke',
    });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'RevokeSessions9!' })
      .expect(204);
    const after = await owner.authSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).toBeTruthy();
  });

  it('HQ reset path works and clears must_change_password', async () => {
    await owner.hqUser.update({
      where: { id: hqUserId },
      data: { mustChangePassword: true },
    });
    const { rawToken } = await actionTokens.createHqResetToken({ hqUserId });
    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'HqResetPass9!' });
    expect(res.status).toBe(204);
    const hq = await owner.hqUser.findUniqueOrThrow({ where: { id: hqUserId } });
    expect(hq.mustChangePassword).toBe(false);
  });

  it('HQ forgot-password enqueues without email in job data', async () => {
    await request(app.getHttpServer())
      .post('/auth/hq/forgot-password')
      .send({ email: hqEmail })
      .expect(202);
    await request(app.getHttpServer())
      .post('/auth/hq/forgot-password')
      .send({ email: 'missing-hq@example.test' })
      .expect(202);
    expect(mailJobs).toHaveLength(1);
    expect(mailJobs[0]).toEqual({
      kind: 'HQ_PASSWORD_RESET',
      tenantId: null,
      userId: hqUserId,
    });
    expect(JSON.stringify(mailJobs[0])).not.toContain(hqEmail);
  });

  it('mail templates use APP_URL hash fragment and no password', async () => {
    await authEmail.sendActivation(tenantId, userId);
    expect(mailJobs).toEqual([{ kind: 'ACTIVATION', tenantId, userId }]);
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.ACTIVATION,
      requestId: 'mail-check',
    });
    const link = actionTokens.buildActivationLink(rawToken);
    expect(link.startsWith('http://127.0.0.1:3001/activate#t=')).toBe(true);
    expect(link).not.toMatch(/password/i);
    const { activationEmail } = await import('../mail/mail.templates');
    const body = activationEmail(link);
    expect(body.text).toContain('#t=');
    expect(body.text.toLowerCase()).not.toContain('password:');
    expect(body.html.toLowerCase()).not.toContain('password:');
  });

  it('concurrency: only one of two simultaneous consumes succeeds', async () => {
    const { rawToken } = await actionTokens.createHospitalToken({
      tenantId,
      userId,
      purpose: AuthActionPurpose.PASSWORD_RESET,
      requestId: 'race',
    });
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'RaceWinner9!!' }),
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'RaceWinner9!!' }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([204, 400]);
    const failed = a.status === 400 ? a : b;
    expect(failed.body).toEqual(INVALID);
  });

  it('RLS: tenant A cannot read tenant B action tokens; app cannot touch HQ table', async () => {
    const stamp = Date.now();
    const other = await owner.hospital.create({
      data: {
        code: `HM_OTHER_${stamp}`,
        name: 'Other',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `other-${stamp}` },
        },
      },
      include: { branches: true },
    });
    const otherUser = await owner.user.create({
      data: {
        tenantId: other.id,
        code: `UO${stamp}`,
        email: `other_${stamp}@example.test`,
        displayName: 'Other',
        passwordHash: 'x',
      },
    });
    const tokenB = await owner.authActionToken.create({
      data: {
        tenantId: other.id,
        userId: otherUser.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: `other-hash-${stamp}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const client = createPgClient('app');
    await client.connect();
    try {
      const seen = await withTenant(client, tenantId, async () => {
        const r = await client.query(`SELECT id FROM auth_action_tokens WHERE id = $1`, [
          tokenB.id,
        ]);
        return r.rowCount ?? 0;
      });
      expect(seen).toBe(0);

      const hqTouch = await client.query(
        `SELECT has_table_privilege('hospigo_app', 'public.hq_auth_action_tokens', 'SELECT') AS ok`,
      );
      expect(hqTouch.rows[0]?.ok).toBe(false);
    } finally {
      await client.end();
    }

    await owner.authActionToken.deleteMany({ where: { tenantId: other.id } });
    await owner.user.deleteMany({ where: { tenantId: other.id } });
    await owner.branch.deleteMany({ where: { tenantId: other.id } });
    await owner.hospital.deleteMany({ where: { id: other.id } });
  });
});
