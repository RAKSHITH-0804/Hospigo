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
import { AuthRedisService } from '../auth/auth-redis.service';
import { PasswordService } from '../auth/password.service';
import { MAIL_PROVIDER } from '../mail/mail.provider';
import { MailProcessor } from '../mail/mail.processor';
import { MailService } from '../mail/mail.service';
import type { MailMessage } from '../mail/mail.types';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the account tests`);
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

describe('account: my profile, email and password (HTTP)', () => {
  jest.setTimeout(120_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const outbox: MailMessage[] = [];
  const queued: unknown[] = [];
  let failSend = false;
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  let redis: AuthRedisService;
  let passwords: PasswordService;
  const stamp = Date.now();
  let seq = 0;
  const email = (tag: string) => `ac_${tag}_${stamp}_${(seq += 1)}@example.test`;
  const people: Record<string, { id: string; tenant: string; email: string; token: string }> = {};
  let tenantA = '';
  let branchA = '';
  let tenantB = '';
  let branchB = '';

  async function person(key: string, tenant: string, branch: string, withRole = true) {
    const mail = email(key);
    const u = await owner.user.create({
      data: {
        tenantId: tenant,
        code: `${key}${stamp}`.slice(0, 40),
        email: mail,
        displayName: `Person ${key}`,
        passwordHash: await passwords.hashTrusted('Original-Password-1'),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    await owner.userBranch.create({ data: { tenantId: tenant, userId: u.id, branchId: branch } });
    if (withRole) {
      const role = await owner.role.create({
        data: { tenantId: tenant, code: `R_${key}_${stamp}`, name: `Role ${key}` },
      });
      const a = await owner.roleAssignment.create({
        data: { tenantId: tenant, userId: u.id, roleId: role.id, scopeType: 'BRANCH' },
      });
      await owner.roleAssignmentBranch.create({
        data: { tenantId: tenant, assignmentId: a.id, branchId: branch },
      });
    }
    people[key] = {
      id: u.id,
      tenant,
      email: mail,
      token: tokenService.signHospitalAccess({ tenantId: tenant, userId: u.id, branchId: branch }),
    };
  }

  async function hospital(label: string) {
    const h = await owner.hospital.create({
      data: {
        code: `AC_${label}_${stamp}`,
        name: `Account ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main Branch', isMain: true, accessCode: `ac-${label}-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    return { tenant: h.id, branch: h.branches[0]!.id };
  }

  beforeAll(async () => {
    const { AppModule } = await import('../../app.module');
    const { TokenService } = await import('../auth/token.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MailService)
      .useValue({
        enqueue: async (job: unknown) => void queued.push(job),
        onModuleDestroy: async () => undefined,
      })
      .overrideProvider(MailProcessor)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: async () => undefined })
      .overrideProvider(MAIL_PROVIDER)
      .useValue({
        send: async (m: MailMessage) => {
          if (failSend) {
            throw new Error('smtp down');
          }
          outbox.push(m);
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    tokenService = app.get(TokenService);
    redis = app.get(AuthRedisService);
    redis.setKeyPrefix(`account-test-${stamp}:`);
    passwords = app.get(PasswordService);
    const a = await hospital('A');
    tenantA = a.tenant;
    branchA = a.branch;
    const b = await hospital('B');
    tenantB = b.tenant;
    branchB = b.branch;
    await person('alice', tenantA, branchA);
    await person('bob', tenantA, branchA);
    await person('carol', tenantB, branchB);
  });

  afterAll(async () => {
    await redis.clearPrefixKeys();
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    outbox.length = 0;
    queued.length = 0;
    failSend = false;
    await redis.clearPrefixKeys();
  });

  const http = () => request(app.getHttpServer());
  type Method = 'get' | 'put' | 'post';
  const call = (method: Method, who: string, url: string, body?: unknown) =>
    (http() as Loose)
      [method](url)
      .set({ Authorization: `Bearer ${people[who]!.token}` })
      .send(body ?? {});
  const codeOf = (message: MailMessage): string => /\b(\d{4,10})\b/.exec(message.subject)![1]!;
  const lastCode = () => codeOf(outbox.at(-1)!);
  const audits = (tenant: string, action: string) =>
    owner.auditLog.findMany({ where: { tenantId: tenant, action }, orderBy: { createdAt: 'asc' } });
  const invalid = (res: Loose, field: string, reason?: string) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SETTINGS_INVALID');
    expect(res.body.field).toBe(field);
    if (reason) expect(res.body.reason).toBe(reason);
  };
  const otpInvalid = (res: Loose, reason: string) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALID');
    expect(res.body.reason).toBe(reason);
  };
  const dbUser = (key: string) => owner.user.findUniqueOrThrow({ where: { id: people[key]!.id } });

  describe('access', () => {
    const ROUTES: Array<[Method, string]> = [
      ['get', '/account/me'],
      ['put', '/account/me'],
      ['post', '/account/email/request'],
      ['post', '/account/email/confirm'],
      ['post', '/account/password/request'],
      ['post', '/account/password/confirm'],
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
    it('every signed-in person has an account page, whatever their role', async () => {
      await person(`norole${seq}`, tenantA, branchA, false);
      const key = Object.keys(people).find((k) => k.startsWith('norole'))!;
      const res = await call('get', key, '/account/me');
      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual([]);
    });
  });

  describe('a switched-off person', () => {
    it('is refused (401) on every account route even with a token that has not expired yet', async () => {
      await person('gone', tenantA, branchA);
      await owner.user.update({ where: { id: people.gone!.id }, data: { isActive: false } });
      const bodies: Array<[Method, string, unknown]> = [
        ['get', '/account/me', undefined],
        ['put', '/account/me', { name: 'Still here' }],
        ['post', '/account/email/request', { email: email('gone-new') }],
        ['post', '/account/email/confirm', { code: '123456' }],
        ['post', '/account/password/request', { email: people.gone!.email }],
        [
          'post',
          '/account/password/confirm',
          { code: '123456', newPassword: 'Gone-Strong-Password-1' },
        ],
      ];
      for (const [method, url, body] of bodies) {
        expect((await call(method, 'gone', url, body)).status).toBe(401);
      }
      expect(outbox).toHaveLength(0);
      expect((await dbUser('gone')).displayName).toBe('Person gone');
    });
  });

  describe('my profile', () => {
    it('shows my own details, found from the token, and nobody else', async () => {
      const res = await call('get', 'alice', '/account/me');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: people.alice!.id,
        name: 'Person alice',
        email: people.alice!.email,
        phone: null,
        branches: ['Main Branch'],
        roles: ['Role alice'],
        isDoctor: false,
        limits: { nameMax: 100, phoneMax: 20 },
      });
      expect((await call('get', 'carol', '/account/me')).body.id).toBe(people.carol!.id);
    });

    it('saves my name and phone, tidied; an empty phone clears it', async () => {
      const res = await call('put', 'alice', '/account/me', {
        name: '  Alice   Rao ',
        phone: '+91 98765 43210',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Alice Rao', phone: '+91 98765 43210' });
      const cleared = await call('put', 'alice', '/account/me', { phone: '  ' });
      expect(cleared.body).toMatchObject({ name: 'Alice Rao', phone: null });
      const trail = (await audits(tenantA, 'ACCOUNT_CHANGE')).filter(
        (t) => t.entityId === people.alice!.id,
      );
      expect(trail.map((t) => t.metadata)).toEqual([
        { changed: ['name', 'phone'] },
        { changed: ['phone'] },
      ]);
      expect(JSON.stringify(trail)).not.toMatch(/Alice Rao|98765/);
      await owner.user.update({
        where: { id: people.alice!.id },
        data: { displayName: 'Person alice' },
      });
    });

    it('refuses bad values, and cannot change the email, code or anyone else through this call', async () => {
      invalid(await call('put', 'alice', '/account/me', []), 'body', 'REQUIRED');
      invalid(await call('put', 'alice', '/account/me', {}), 'body', 'REQUIRED');
      invalid(await call('put', 'alice', '/account/me', { email: 'x@y.test' }), 'body', 'REQUIRED');
      invalid(await call('put', 'alice', '/account/me', { name: '' }), 'name', 'REQUIRED');
      invalid(
        await call('put', 'alice', '/account/me', { name: 'x'.repeat(101) }),
        'name',
        'TOO_LONG',
      );
      invalid(await call('put', 'alice', '/account/me', { name: 'a\u0000b' }), 'name', 'INVALID');
      invalid(await call('put', 'alice', '/account/me', { phone: 'abc' }), 'phone', 'INVALID');
      const sneaky = await call('put', 'alice', '/account/me', {
        name: 'Still Alice',
        id: people.bob!.id,
        userId: people.bob!.id,
        email: 'hijack@example.test',
        code: 'ROOT',
        isActive: false,
      });
      expect(sneaky.status).toBe(200);
      expect(sneaky.body.id).toBe(people.alice!.id);
      const bob = await dbUser('bob');
      expect(bob.displayName).toBe('Person bob');
      const alice = await dbUser('alice');
      expect(alice).toMatchObject({
        displayName: 'Still Alice',
        email: people.alice!.email,
        isActive: true,
      });
      expect(alice.code).not.toBe('ROOT');
      await owner.user.update({
        where: { id: people.alice!.id },
        data: { displayName: 'Person alice' },
      });
    });
  });

  describe('changing the email address', () => {
    it('a code goes to the NEW address; the old address stays until the code is confirmed', async () => {
      const mail = email('newaddr');
      const res = await call('post', 'alice', '/account/email/request', {
        email: `  ${mail.toUpperCase()} `,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: true });
      expect(outbox).toHaveLength(1);
      expect(outbox[0]!.to).toBe(mail);
      expect(outbox[0]!.text).toContain('change your email address');
      expect(queued).toEqual([]); // nothing secret goes through the mail queue
      expect((await dbUser('alice')).email).toBe(people.alice!.email);
      const done = await call('post', 'alice', '/account/email/confirm', { code: lastCode() });
      expect(done.status).toBe(200);
      expect(done.body.email).toBe(mail);
      expect((await dbUser('alice')).email).toBe(mail);
      expect(JSON.stringify(await audits(tenantA, 'ACCOUNT_EMAIL_CHANGE'))).not.toContain(mail);
      // the code works once
      otpInvalid(
        await call('post', 'alice', '/account/email/confirm', { code: '000000' }),
        'EXPIRED',
      );
      people.alice!.email = mail;
    });

    it('refuses the same address, a bad one, one already used (any case), and sends nothing', async () => {
      const send = (body: unknown) => call('post', 'alice', '/account/email/request', body);
      invalid(await send({}), 'email', 'REQUIRED');
      invalid(await send({ email: 'not-an-email' }), 'email', 'INVALID');
      invalid(await send({ email: people.alice!.email.toUpperCase() }), 'email', 'SAME');
      invalid(await send({ email: people.bob!.email.toUpperCase() }), 'email', 'DUPLICATE');
      expect(outbox).toHaveLength(0);
      // the same address in ANOTHER hospital is fine: logins are per hospital
      expect((await send({ email: people.carol!.email })).status).toBe(200);
    });

    it('a wrong code is refused; too many wrong tries end the code, even for the right one after that', async () => {
      await call('post', 'alice', '/account/email/request', { email: email('tries') });
      const right = lastCode();
      const wrong = right === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i++) {
        otpInvalid(
          await call('post', 'alice', '/account/email/confirm', { code: wrong }),
          'WRONG_CODE',
        );
      }
      otpInvalid(
        await call('post', 'alice', '/account/email/confirm', { code: wrong }),
        'TOO_MANY_TRIES',
      );
      otpInvalid(await call('post', 'alice', '/account/email/confirm', { code: right }), 'EXPIRED');
      expect((await dbUser('alice')).email).toBe(people.alice!.email);
    });

    it('a confirm needs a code of digits, and a code asked for the password cannot change the email', async () => {
      invalid(await call('post', 'alice', '/account/email/confirm', {}), 'code', 'REQUIRED');
      invalid(
        await call('post', 'alice', '/account/email/confirm', { code: 'abcdef' }),
        'code',
        'INVALID',
      );
      invalid(
        await call('post', 'alice', '/account/email/confirm', { code: '12' }),
        'code',
        'INVALID',
      );
      invalid(
        await call('post', 'alice', '/account/email/confirm', { code: 5 }),
        'code',
        'REQUIRED',
      );
      await call('post', 'alice', '/account/password/request', { email: people.alice!.email });
      otpInvalid(
        await call('post', 'alice', '/account/email/confirm', { code: lastCode() }),
        'EXPIRED',
      );
    });

    it("somebody else's code does not work for me", async () => {
      await call('post', 'bob', '/account/email/request', { email: email('bobnew') });
      const bobsCode = lastCode();
      otpInvalid(
        await call('post', 'alice', '/account/email/confirm', { code: bobsCode }),
        'EXPIRED',
      );
      otpInvalid(
        await call('post', 'carol', '/account/email/confirm', { code: bobsCode }),
        'EXPIRED',
      );
      expect((await call('post', 'bob', '/account/email/confirm', { code: bobsCode })).status).toBe(
        200,
      );
    });

    it('an address taken by someone else between the request and the confirm is refused', async () => {
      const mail = email('race');
      await call('post', 'alice', '/account/email/request', { email: mail });
      const code = lastCode();
      await owner.user.update({ where: { id: people.bob!.id }, data: { email: mail } });
      invalid(
        await call('post', 'alice', '/account/email/confirm', { code }),
        'email',
        'DUPLICATE',
      );
      expect((await dbUser('alice')).email).toBe(people.alice!.email);
      await owner.user.update({
        where: { id: people.bob!.id },
        data: { email: people.bob!.email },
      });
    });

    it('requests are spaced out: a second one at once is told to wait', async () => {
      expect(
        (await call('post', 'alice', '/account/email/request', { email: email('one') })).status,
      ).toBe(200);
      const second = await call('post', 'alice', '/account/email/request', { email: email('two') });
      expect(second.status).toBe(429);
      expect(second.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(second.body.retryAfterSec).toBeGreaterThan(0);
      expect(outbox).toHaveLength(1);
    });

    it('when the email cannot be sent the person is told, and no code stays behind', async () => {
      failSend = true;
      const res = await call('post', 'alice', '/account/email/request', { email: email('down') });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('UNAVAILABLE');
      failSend = false;
      await redis.clearPrefixKeys();
      otpInvalid(
        await call('post', 'alice', '/account/email/confirm', { code: '123456' }),
        'EXPIRED',
      );
    });
  });

  describe('changing the password', () => {
    it('the address typed must be my own: otherwise 400 and nothing is sent', async () => {
      const send = (body: unknown) => call('post', 'alice', '/account/password/request', body);
      invalid(await send({}), 'email', 'REQUIRED');
      invalid(await send({ email: 'not-an-email' }), 'email', 'INVALID');
      invalid(await send({ email: people.bob!.email }), 'email', 'MISMATCH');
      expect(outbox).toHaveLength(0);
    });

    it('a code goes to my own address; the new password is set; every session ends; the audit has no password', async () => {
      const sessions = [] as string[];
      for (const n of [1, 2]) {
        const s = await owner.authSession.create({
          data: {
            tenantId: tenantA,
            userId: people.alice!.id,
            branchId: branchA,
            tokenHash: `pw-${stamp}-${n}`,
            familyId: `pwf-${stamp}-${n}`,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
        sessions.push(s.id);
      }
      const send = await call('post', 'alice', '/account/password/request', {
        email: people.alice!.email.toUpperCase(),
      });
      expect(send.status).toBe(200);
      expect(outbox[0]!.to).toBe(people.alice!.email);
      expect(outbox[0]!.text).toContain('change your password');
      const res = await call('post', 'alice', '/account/password/confirm', {
        code: lastCode(),
        newPassword: 'My-New-Strong-Password-9',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ changed: true, signedOutEverywhere: true });
      const row = await dbUser('alice');
      expect(await passwords.verify(row.passwordHash, 'My-New-Strong-Password-9')).toBe(true);
      expect(await passwords.verify(row.passwordHash, 'Original-Password-1')).toBe(false);
      expect(row.mustChangePassword).toBe(false);
      expect(row.passwordChangedAt).not.toBeNull();
      const revoked = await owner.authSession.findMany({ where: { id: { in: sessions } } });
      expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
      const trail = (await audits(tenantA, 'ACCOUNT_PASSWORD_CHANGE')).at(-1)!;
      expect(trail.metadata).toEqual({ changed: ['password'] });
      expect(JSON.stringify(trail)).not.toContain('My-New-Strong');
      // the code works once
      await redis.clearPrefixKeys();
      otpInvalid(
        await call('post', 'alice', '/account/password/confirm', {
          code: '123456',
          newPassword: 'Another-Strong-Password-1',
        }),
        'EXPIRED',
      );
    });

    it('a weak password is refused BEFORE the code is used, so the code still works', async () => {
      await call('post', 'alice', '/account/password/request', { email: people.alice!.email });
      const code = lastCode();
      const before = (await dbUser('alice')).passwordHash;
      invalid(
        await call('post', 'alice', '/account/password/confirm', { code, newPassword: 'short' }),
        'newPassword',
        'TOO_SHORT',
      );
      invalid(
        await call('post', 'alice', '/account/password/confirm', {
          code,
          newPassword: 'password1234',
        }),
        'newPassword',
        'COMMON_PASSWORD',
      );
      invalid(
        await call('post', 'alice', '/account/password/confirm', { code }),
        'newPassword',
        'REQUIRED',
      );
      invalid(
        await call('post', 'alice', '/account/password/confirm', { code, newPassword: 12345678 }),
        'newPassword',
        'REQUIRED',
      );
      expect((await dbUser('alice')).passwordHash).toBe(before);
      expect(
        (
          await call('post', 'alice', '/account/password/confirm', {
            code,
            newPassword: 'Second-Strong-Password-2',
          })
        ).status,
      ).toBe(200);
    });

    it('a wrong code changes nothing; five wrong tries end the code', async () => {
      await call('post', 'alice', '/account/password/request', { email: people.alice!.email });
      const right = lastCode();
      const wrong = right === '111111' ? '222222' : '111111';
      const before = (await dbUser('alice')).passwordHash;
      for (let i = 0; i < 5; i++) {
        otpInvalid(
          await call('post', 'alice', '/account/password/confirm', {
            code: wrong,
            newPassword: 'Third-Strong-Password-3',
          }),
          'WRONG_CODE',
        );
      }
      otpInvalid(
        await call('post', 'alice', '/account/password/confirm', {
          code: wrong,
          newPassword: 'Third-Strong-Password-3',
        }),
        'TOO_MANY_TRIES',
      );
      otpInvalid(
        await call('post', 'alice', '/account/password/confirm', {
          code: right,
          newPassword: 'Third-Strong-Password-3',
        }),
        'EXPIRED',
      );
      expect((await dbUser('alice')).passwordHash).toBe(before);
    });

    it('two confirms with the same good code at once: only one wins', async () => {
      await call('post', 'bob', '/account/password/request', { email: people.bob!.email });
      const code = lastCode();
      const results = await Promise.all([
        call('post', 'bob', '/account/password/confirm', {
          code,
          newPassword: 'Race-Strong-Password-7',
        }),
        call('post', 'bob', '/account/password/confirm', {
          code,
          newPassword: 'Race-Strong-Password-8',
        }),
        call('post', 'bob', '/account/password/confirm', {
          code,
          newPassword: 'Race-Strong-Password-9',
        }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) {
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('OTP_INVALID');
      }
    });

    it('requests are spaced out, and the code of another person or of another purpose never works', async () => {
      expect(
        (await call('post', 'alice', '/account/password/request', { email: people.alice!.email }))
          .status,
      ).toBe(200);
      const alicesCode = lastCode();
      expect(
        (await call('post', 'alice', '/account/password/request', { email: people.alice!.email }))
          .status,
      ).toBe(429);
      otpInvalid(
        await call('post', 'bob', '/account/password/confirm', {
          code: alicesCode,
          newPassword: 'Bob-Strong-Password-4',
        }),
        'EXPIRED',
      );
      otpInvalid(
        await call('post', 'carol', '/account/password/confirm', {
          code: alicesCode,
          newPassword: 'Carol-Strong-Password-4',
        }),
        'EXPIRED',
      );
    });

    it('the code mail never carries the password, and the code is not in the mail queue', async () => {
      await call('post', 'alice', '/account/password/request', { email: people.alice!.email });
      expect(queued).toEqual([]);
      expect(outbox[0]!.html + outbox[0]!.text).not.toMatch(/Original-Password|passwordHash/);
      expect(outbox[0]!.subject).toMatch(/^Your Hospigo code: \d{4,10}$/);
    });
  });
});
