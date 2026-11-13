/**
 * Patient OTP auth HTTP e2e (Step 6c).
 */
import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createOwnerPrisma, createPgClient } from '../../database/db-test.util';
import { MESSAGE_PROVIDER, type MessageProvider } from '../messaging/message.provider';

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
  OTP_IP_RATE_LIMIT_PER_MIN: '100',
  OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR: '20',
  OTP_RESEND_COOLDOWN_SEC: '5',
  OTP_MAX_ATTEMPTS: '5',
  OTP_TTL_SEC: '300',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
});

const TEST_PREFIX = 'hospigo:auth:patient:otp:';

class CaptureMessageProvider implements MessageProvider {
  last: { channel: string; phone: string; text: string } | null = null;
  async send(channel: string, phoneE164: string, text: string): Promise<void> {
    this.last = { channel, phone: phoneE164, text };
  }
  codeFromLast(): string {
    const m = this.last?.text.match(/\b(\d{6})\b/);
    if (!m) throw new Error('No OTP in last message');
    return m[1]!;
  }
}

describe('Patient OTP auth (HTTP)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('../auth/auth-redis.service').AuthRedisService;
  let capture: CaptureMessageProvider;
  const phoneA = '9876543210';
  const phoneB = '9123456780';

  beforeAll(async () => {
    capture = new CaptureMessageProvider();
    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGE_PROVIDER)
      .useValue(capture)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
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
    await owner.patientAuthSession.deleteMany({}).catch(() => undefined);
    await owner.patientOtpChallenge.deleteMany({}).catch(() => undefined);
    await owner.patientAccount.deleteMany({}).catch(() => undefined);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await redis.clearPrefixKeys();
    capture.last = null;
    await owner.patientAuthSession.deleteMany({});
    await owner.patientOtpChallenge.deleteMany({});
    await owner.patientAccount.deleteMany({});
  });

  function requestOtp(phone: string) {
    return request(app.getHttpServer()).post('/patient/auth/request-otp').send({ phone });
  }

  function verifyOtp(phone: string, code: string) {
    return request(app.getHttpServer()).post('/patient/auth/verify-otp').send({ phone, code });
  }

  it('request-otp returns identical shape for new and existing phones', async () => {
    const a = await requestOtp(phoneA).expect(200);
    expect(a.body).toEqual({ ok: true, resendAfterSec: expect.any(Number) });
    await redis.clearPrefixKeys();
    await owner.patientAccount.create({
      data: { phoneE164: '+919876543210', status: 'ACTIVE' },
    });
    const b = await requestOtp(phoneA).expect(200);
    expect(b.body).toEqual({ ok: true, resendAfterSec: expect.any(Number) });
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
  });

  it('enforces resend cooldown', async () => {
    await requestOtp(phoneA).expect(200);
    const again = await requestOtp(phoneA).expect(429);
    expect(again.headers['retry-after']).toBeDefined();
  });

  it('enforces per-phone hourly limit', async () => {
    process.env.OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR = '2';
    // Re-read config is frozen on AuthConfig at boot — use redis counters directly via many requests
    // with cooldown cleared between. Config is already 20 from Object.assign before boot.
    // Lower limit was set before AppModule load above (20). Use a dedicated phone and burn 20.
    const phone = '9000011111';
    for (let i = 0; i < 20; i++) {
      await redis.clearPrefixKeys(); // clears cooldown but also hourly — bad
    }
    // Use assert via repeated requests without clearing hour key: only clear cool keys manually
    await redis.clearPrefixKeys();
    const limit = 20;
    for (let i = 0; i < limit; i++) {
      // bypass cooldown by clearing only cool key pattern — clearPrefixKeys clears all
      // Instead set OTP_RESEND low and wait — use mark by deleting cool keys via clear and
      // re-incr hour... Simpler: call assertOtpPhoneHourlyAllowed in a unit-style loop.
      await redis.assertOtpPhoneHourlyAllowed(redis.phoneKeyMaterial(`+91${phone}`));
    }
    await expect(
      redis.assertOtpPhoneHourlyAllowed(redis.phoneKeyMaterial(`+91${phone}`)),
    ).rejects.toThrow(/AUTH_RATE_LIMITED/);
  });

  it('enforces per-IP OTP limit', async () => {
    // Burn IP counter under otp:ip
    const auth = (await import('../auth/auth.config')).loadAuthConfig(process.env);
    for (let i = 0; i < auth.otpIpRateLimitPerMinute; i++) {
      await redis.assertOtpIpAllowed('203.0.113.50');
    }
    await expect(redis.assertOtpIpAllowed('203.0.113.50')).rejects.toThrow(/AUTH_RATE_LIMITED/);
  });

  it('verify-otp success creates account; second login reuses it', async () => {
    await requestOtp(phoneA).expect(200);
    const code = capture.codeFromLast();
    const first = await verifyOtp(phoneA, code).expect(200);
    expect(first.body.accessToken).toBeTruthy();
    expect(first.body.refreshToken).toMatch(/^p\./);
    const id1 = (
      await request(app.getHttpServer())
        .get('/patient/me')
        .set('Authorization', `Bearer ${first.body.accessToken}`)
        .expect(200)
    ).body.id;

    await redis.clearPrefixKeys();
    await requestOtp(phoneA).expect(200);
    const second = await verifyOtp(phoneA, capture.codeFromLast()).expect(200);
    const id2 = (
      await request(app.getHttpServer())
        .get('/patient/me')
        .set('Authorization', `Bearer ${second.body.accessToken}`)
        .expect(200)
    ).body.id;
    expect(id2).toBe(id1);
    expect(await owner.patientAccount.count({ where: { phoneE164: '+919876543210' } })).toBe(1);
  });

  it('wrong code then 5 attempts kill the challenge; consumed cannot reuse', async () => {
    await requestOtp(phoneB).expect(200);
    const code = capture.codeFromLast();
    for (let i = 0; i < 4; i++) {
      await verifyOtp(phoneB, '000000').expect(401);
    }
    await verifyOtp(phoneB, '000000').expect(401);
    await verifyOtp(phoneB, code).expect(401);
  });

  it('expired challenge fails generically', async () => {
    await requestOtp(phoneA).expect(200);
    const code = capture.codeFromLast();
    await owner.patientOtpChallenge.updateMany({
      where: { phoneE164: '+919876543210' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await verifyOtp(phoneA, code).expect(401);
  });

  it('disabled account fails verify generically', async () => {
    await requestOtp(phoneA).expect(200);
    const code = capture.codeFromLast();
    await owner.patientAccount.upsert({
      where: { phoneE164: '+919876543210' },
      create: { phoneE164: '+919876543210', status: 'DISABLED' },
      update: { status: 'DISABLED' },
    });
    await verifyOtp(phoneA, code).expect(401);
  });

  it('refresh rotation + reuse revokes family; logout revokes', async () => {
    await requestOtp(phoneA).expect(200);
    const login = await verifyOtp(phoneA, capture.codeFromLast()).expect(200);
    const r1 = login.body.refreshToken as string;
    const rotated = await request(app.getHttpServer())
      .post('/patient/auth/refresh')
      .send({ refreshToken: r1 })
      .expect(200);
    await request(app.getHttpServer())
      .post('/patient/auth/refresh')
      .send({ refreshToken: r1 })
      .expect(401);
    await request(app.getHttpServer())
      .post('/patient/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);

    await redis.clearPrefixKeys();
    await requestOtp(phoneA).expect(200);
    const again = await verifyOtp(phoneA, capture.codeFromLast()).expect(200);
    await request(app.getHttpServer())
      .post('/patient/auth/logout')
      .send({ refreshToken: again.body.refreshToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/patient/auth/refresh')
      .send({ refreshToken: again.body.refreshToken })
      .expect(401);
  });

  it('20 parallel wrong-code verifies: attempts never exceed max; correct code then 401', async () => {
    const phone = '9000022222';
    await requestOtp(phone).expect(200);
    const code = capture.codeFromLast();
    const maxAttempts = 5;
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyOtp(phone, '000000')));
    expect(results.every((r) => r.status === 401)).toBe(true);
    const challenge = await owner.patientOtpChallenge.findFirst({
      where: { phoneE164: `+91${phone}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(challenge).toBeTruthy();
    expect(challenge!.attempts).toBeLessThanOrEqual(maxAttempts);
    expect(challenge!.attempts).toBe(maxAttempts);
    expect(challenge!.consumedAt).not.toBeNull();
    await verifyOtp(phone, code).expect(401);
  });

  it('5 parallel correct-code verifies: exactly one 200 with tokens; one account', async () => {
    const phone = '9000033333';
    await requestOtp(phone).expect(200);
    const code = capture.codeFromLast();
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyOtp(phone, code)));
    const ok = results.filter((r) => r.status === 200);
    const denied = results.filter((r) => r.status === 401);
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(4);
    expect(ok[0]!.body.accessToken).toBeTruthy();
    expect(ok[0]!.body.refreshToken).toMatch(/^p\./);
    expect(await owner.patientAccount.count({ where: { phoneE164: `+91${phone}` } })).toBe(1);
  });

  it('logout is public: works without/with bad Bearer; unknown refresh still ok', async () => {
    await requestOtp(phoneA).expect(200);
    const login = await verifyOtp(phoneA, capture.codeFromLast()).expect(200);
    const refresh = login.body.refreshToken as string;

    const expiredish = await request(app.getHttpServer())
      .post('/patient/auth/logout')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid')
      .send({ refreshToken: refresh })
      .expect(200);
    expect(expiredish.body).toEqual({ ok: true });

    await request(app.getHttpServer())
      .post('/patient/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(401);

    await redis.clearPrefixKeys();
    await requestOtp(phoneA).expect(200);
    const again = await verifyOtp(phoneA, capture.codeFromLast()).expect(200);
    const noBearer = await request(app.getHttpServer())
      .post('/patient/auth/logout')
      .send({ refreshToken: again.body.refreshToken })
      .expect(200);
    expect(noBearer.body).toEqual({ ok: true });
    await request(app.getHttpServer())
      .post('/patient/auth/refresh')
      .send({ refreshToken: again.body.refreshToken })
      .expect(401);

    const unknown = await request(app.getHttpServer())
      .post('/patient/auth/logout')
      .send({ refreshToken: 'p.not-a-real-session.ffffffffffffffffffffffffffffffff' })
      .expect(200);
    expect(unknown.body).toEqual({ ok: true });
  });

  it('Redis down => 503 for OTP IP check (fail-closed)', async () => {
    const { AuthRedisService } = await import('../auth/auth-redis.service');
    const { loadAuthConfig } = await import('../auth/auth.config');
    const auth = loadAuthConfig(process.env);
    const dead = new AuthRedisService({
      getOrThrow: (key: string) => {
        if (key === 'auth') return auth;
        if (key === 'REDIS_URL') return 'redis://127.0.0.1:1';
        throw new Error(key);
      },
    } as never);
    await expect(dead.assertOtpIpAllowed('1.2.3.4')).rejects.toMatchObject({ status: 503 });
    await expect(dead.assertOtpPhoneHourlyAllowed('abc')).rejects.toMatchObject({ status: 503 });
    await dead.onModuleDestroy().catch(() => undefined);
  });

  it('token separation both ways; wrong secret rejected', async () => {
    await requestOtp(phoneA).expect(200);
    const patientLogin = await verifyOtp(phoneA, capture.codeFromLast()).expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${patientLogin.body.accessToken}`)
      .expect(401);

    // Staff/HQ tokens on /patient/me — use TokenService to mint
    const tokens = app.get((await import('../auth/token.service')).TokenService);
    const hospital = tokens.signHospitalAccess({
      tenantId: 't',
      userId: 'u',
      branchId: 'b',
    });
    const hq = tokens.signHqAccess({ userId: 'hq' });
    await request(app.getHttpServer())
      .get('/patient/me')
      .set('Authorization', `Bearer ${hospital}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/patient/me')
      .set('Authorization', `Bearer ${hq}`)
      .expect(401);

    const jwt = await import('jsonwebtoken');
    const forged = jwt.default.sign(
      { tokenType: 'PATIENT', accountId: 'x', sub: 'x' },
      'wrong-secret-wrong-secret-wrong-secret!!',
      { algorithm: 'HS256', expiresIn: 60 },
    );
    await request(app.getHttpServer())
      .get('/patient/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('role grants: app and hq denied on patient tables; patient denied on users/patients/audit', async () => {
    const appClient = createPgClient('app');
    const hqClient = createPgClient('hq');
    await appClient.connect();
    await hqClient.connect();
    await expect(appClient.query('SELECT 1 FROM patient_accounts')).rejects.toThrow();
    await expect(hqClient.query('SELECT 1 FROM patient_otp_challenges')).rejects.toThrow();
    await expect(appClient.query('SELECT 1 FROM patient_auth_sessions')).rejects.toThrow();
    await appClient.end();
    await hqClient.end();

    const patient = new (await import('pg')).Client({
      connectionString: patientUrlOnTestDb(),
      connectionTimeoutMillis: 5000,
    });
    await patient.connect();
    await expect(patient.query('SELECT 1 FROM users')).rejects.toThrow();
    await expect(patient.query('SELECT 1 FROM patients')).rejects.toThrow();
    await expect(patient.query('SELECT 1 FROM audit_logs')).rejects.toThrow();
    await patient.query('SELECT 1 FROM patient_accounts');
    await patient.end();
  });
});
