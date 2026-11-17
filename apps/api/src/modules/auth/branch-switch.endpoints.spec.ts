import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createOwnerPrisma } from '../../database/db-test.util';
import { AUTH_FAILED_MESSAGE } from './auth.errors';
import { AUTH_REDIS_KEY_PREFIX } from './auth.config';
import { BRANCH_NOT_AVAILABLE_MESSAGE, NOT_A_SWITCHER_MESSAGE } from './branch-switch.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for branch switch tests`);
  }
  const u = new URL(raw);
  if (owner) {
    if (u.pathname.replace(/^\//, '') !== 'hospigo_test') {
      throw new Error(`Refusing database "${u.pathname}". Expected hospigo_test.`);
    }
    return u.toString();
  }
  u.pathname = '/hospigo_test';
  return u.toString();
}

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '',
  DATABASE_URL_OWNER: testUrl(
    process.env.DATABASE_URL_OWNER_TEST ? 'DATABASE_URL_OWNER_TEST' : 'DATABASE_URL_OWNER',
    true,
  ),
  DATABASE_URL_HQ: testUrl('DATABASE_URL_HQ'),
  DATABASE_URL_PATIENT: testUrl('DATABASE_URL_PATIENT'),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  AUTH_IP_RATE_LIMIT_PER_MIN: '1000',
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

const TEST_PREFIX = 'hospigo:auth:test-switch:';

type Login = { accessToken: string; refreshToken: string };

describe('Branch switcher (Step 3d)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('./auth-redis.service').AuthRedisService;
  let tokens: import('./token.service').TokenService;

  const password = 'CorrectHorse9!';
  const stamp = Date.now();
  let tenantId: string;
  let mainId: string;
  let eastId: string;
  let westInactiveId: string;
  let otherTenantId: string;
  let otherBranchId: string;
  let otherAccessCode: string;
  const codes = { main: `sw-main-${stamp}`, east: `sw-east-${stamp}` };
  const emails = {
    superAdmin: `sw_super_${stamp}@example.test`,
    admin: `sw_admin_${stamp}@example.test`,
    reception: `sw_recep_${stamp}@example.test`,
    nurse: `sw_nurse_${stamp}@example.test`,
    otherSuper: `sw_osuper_${stamp}@example.test`,
  };
  const ids: Record<string, string> = {};
  let moduleMain: string;
  let moduleEast: string;

  beforeAll(async () => {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const permission = await owner.permission.findFirst({
      where: { code: 'patients.registry.read', isActive: true },
    });
    if (!permission) {
      throw new Error('Reference permission patients.registry.read missing in hospigo_test');
    }
    const modules = await owner.module.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    if (modules.length < 2) {
      throw new Error('Need at least two reference modules in hospigo_test');
    }
    moduleMain = modules[0]!.code;
    moduleEast = modules[1]!.code;

    const hospital = await owner.hospital.create({
      data: {
        code: `SW_${stamp}`,
        name: 'Switch Hospital',
        isTest: true,
        status: 'ACTIVE',
        branches: {
          create: [
            { code: 'MAIN', name: 'Main Branch', isMain: true, accessCode: codes.main },
            { code: 'EAST', name: 'East Branch', isMain: false, accessCode: codes.east },
            {
              code: 'WEST',
              name: 'West Branch',
              isMain: false,
              accessCode: `sw-west-${stamp}`,
              isActive: false,
            },
          ],
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;
    mainId = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    eastId = hospital.branches.find((b) => b.code === 'EAST')!.id;
    westInactiveId = hospital.branches.find((b) => b.code === 'WEST')!.id;

    // Module m0 only on MAIN, m1 only on EAST: a switch must change enabledModules.
    for (const mod of modules.slice(0, 2)) {
      await owner.hospitalModuleSubscription.create({
        data: { tenantId, moduleId: mod.id, isActive: true },
      });
    }
    await owner.branchModule.create({
      data: {
        tenantId,
        branchId: mainId,
        moduleId: modules[0]!.id,
        enabledByIndigo: true,
        restrictedByHospital: false,
        isActive: true,
      },
    });
    await owner.branchModule.create({
      data: {
        tenantId,
        branchId: eastId,
        moduleId: modules[1]!.id,
        enabledByIndigo: true,
        restrictedByHospital: false,
        isActive: true,
      },
    });

    async function user(key: keyof typeof emails, code: string): Promise<string> {
      const u = await owner.user.create({
        data: {
          tenantId,
          code: `${code}${stamp}`,
          email: emails[key],
          displayName: `Person ${key}`,
          passwordHash: hash,
          mustChangePassword: false,
        },
      });
      await owner.userBranch.create({ data: { tenantId, userId: u.id, branchId: mainId } });
      ids[key] = u.id;
      return u.id;
    }

    // SuperAdmin: hospital-wide scope, membership ONLY on MAIN.
    const superId = await user('superAdmin', 'SUP');
    const superRole = await owner.role.create({
      data: {
        tenantId,
        code: 'SUPER_ADMIN',
        name: 'Super admin',
        permissions: { create: { permissionId: permission.id } },
        roleAssignments: { create: { userId: superId, scopeType: 'HOSPITAL' } },
      },
    });
    ids.superRole = superRole.id;

    // Branch-scoped staff (must never switch).
    for (const [key, code, roleCode] of [
      ['admin', 'ADM', 'BRANCH_ADMIN'],
      ['reception', 'REC', 'RECEPTIONIST'],
      ['nurse', 'NUR', 'NURSE'],
    ] as const) {
      const uid = await user(key, code);
      const role = await owner.role.create({
        data: { tenantId, code: roleCode, name: roleCode },
      });
      const assignment = await owner.roleAssignment.create({
        data: { tenantId, userId: uid, roleId: role.id, scopeType: 'BRANCH' },
      });
      await owner.roleAssignmentBranch.create({
        data: { tenantId, assignmentId: assignment.id, branchId: mainId },
      });
    }

    // Another hospital with its own hospital-wide SuperAdmin.
    otherAccessCode = `sw-other-${stamp}`;
    const other = await owner.hospital.create({
      data: {
        code: `SWO_${stamp}`,
        name: 'Other Hospital',
        isTest: true,
        status: 'ACTIVE',
        branches: {
          create: { code: 'MAIN', name: 'Other Main', isMain: true, accessCode: otherAccessCode },
        },
      },
      include: { branches: true },
    });
    otherTenantId = other.id;
    otherBranchId = other.branches[0]!.id;
    const ou = await owner.user.create({
      data: {
        tenantId: otherTenantId,
        code: `OSU${stamp}`,
        email: emails.otherSuper,
        displayName: 'Other super',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.create({
      data: { tenantId: otherTenantId, userId: ou.id, branchId: otherBranchId },
    });
    await owner.role.create({
      data: {
        tenantId: otherTenantId,
        code: 'SUPER_ADMIN',
        name: 'Super admin',
        roleAssignments: { create: { userId: ou.id, scopeType: 'HOSPITAL' } },
      },
    });
    ids.otherSuper = ou.id;

    const { AppModule } = await import('../../app.module');
    const { AuthRedisService } = await import('./auth-redis.service');
    const { TokenService } = await import('./token.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
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
    // Restore anything a test switched off.
    await owner.roleAssignment.updateMany({
      where: { tenantId, userId: ids.superAdmin },
      data: { isActive: true },
    });
    await owner.role.updateMany({ where: { id: ids.superRole }, data: { isActive: true } });
    await owner.user.updateMany({ where: { id: ids.superAdmin }, data: { isActive: true } });
    await owner.userBranch.updateMany({
      where: { userId: ids.superAdmin },
      data: { isActive: true },
    });
  });

  afterAll(async () => {
    redis.setKeyPrefix(AUTH_REDIS_KEY_PREFIX);
    await app.close();
    await owner.$disconnect();
  });

  const http = () => request(app.getHttpServer());

  async function login(accessCode: string, email: string): Promise<Login> {
    const res = await http().post('/auth/hospital/login').send({ accessCode, email, password });
    expect(res.status).toBe(200);
    return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
  }
  const loginSuper = () => login(codes.main, emails.superAdmin);

  function switchTo(accessToken: string, branchId: string, refreshToken: string) {
    return http()
      .post('/auth/switch-branch')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ branchId, refreshToken });
  }
  function me(accessToken: string) {
    return http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
  }
  function refresh(refreshToken: string) {
    return http().post('/auth/refresh').send({ refreshToken });
  }
  function sessionIdOf(refreshToken: string): string {
    return refreshToken.split('.')[2]!;
  }
  async function liveSessions(sessionId: string): Promise<number> {
    const s = await owner.authSession.findUniqueOrThrow({ where: { id: sessionId } });
    return owner.authSession.count({ where: { familyId: s.familyId, revokedAt: null } });
  }

  // ---------------------------------------------------------------- happy path

  it('lists active branches of the own hospital for a hospital-wide user', async () => {
    const { accessToken } = await loginSuper();
    const res = await http()
      .get('/auth/switchable-branches')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: mainId, name: 'Main Branch', isMain: true, isCurrent: true },
      { id: eastId, name: 'East Branch', isMain: false, isCurrent: false },
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(westInactiveId);
    expect(text).not.toContain(otherBranchId);
  });

  it('switches branch: /auth/me shows the new branch, modules and permissions are recomputed', async () => {
    const first = await loginSuper();
    const meMain = await me(first.accessToken);
    expect(meMain.body.activeBranchId).toBe(mainId);
    expect(meMain.body.canSwitchBranch).toBe(true);
    expect(meMain.body.enabledModules.map((m: { code: string }) => m.code)).toEqual([moduleMain]);

    const res = await switchTo(first.accessToken, eastId, first.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(false);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(first.refreshToken);

    const meEast = await me(res.body.accessToken);
    expect(meEast.status).toBe(200);
    expect(meEast.body.activeBranchId).toBe(eastId);
    // Name is read directly: the user has NO membership row on East.
    expect(meEast.body.activeBranchName).toBe('East Branch');
    expect(meEast.body.enabledModules.map((m: { code: string }) => m.code)).toEqual([moduleEast]);
    expect(meEast.body.permissions).toContain('patients.registry.read');
    expect(meEast.body.canSwitchBranch).toBe(true);
  });

  it('the new refresh token keeps working on the new branch (no membership needed)', async () => {
    const first = await loginSuper();
    const sw = await switchTo(first.accessToken, eastId, first.refreshToken);
    const r1 = await refresh(sw.body.refreshToken);
    expect(r1.status).toBe(200);
    const meAfter = await me(r1.body.accessToken);
    expect(meAfter.body.activeBranchId).toBe(eastId);
    const r2 = await refresh(r1.body.refreshToken);
    expect(r2.status).toBe(200);
  });

  it('can switch back and forth', async () => {
    const first = await loginSuper();
    const toEast = await switchTo(first.accessToken, eastId, first.refreshToken);
    const back = await switchTo(toEast.body.accessToken, mainId, toEast.body.refreshToken);
    expect(back.status).toBe(200);
    expect((await me(back.body.accessToken)).body.activeBranchId).toBe(mainId);
  });

  it('the old access token still works for its OWN (old) branch until it expires', async () => {
    const first = await loginSuper();
    await switchTo(first.accessToken, eastId, first.refreshToken);
    const stale = await me(first.accessToken);
    expect(stale.status).toBe(200);
    expect(stale.body.activeBranchId).toBe(mainId);
  });

  it('audits the switch with ids only (no emails, names or tokens)', async () => {
    const first = await loginSuper();
    const sw = await switchTo(first.accessToken, eastId, first.refreshToken);
    expect(sw.status).toBe(200);
    const rows = await owner.auditLog.findMany({
      where: { tenantId, action: 'AUTH_BRANCH_SWITCH', actorUserId: ids.superAdmin },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.branchId).toBe(eastId);
    expect(row.entityId).toBe(ids.superAdmin);
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.fromBranchId).toBe(mainId);
    expect(meta.toBranchId).toBe(eastId);
    expect(Object.keys(meta).sort()).toEqual([
      'fromBranchId',
      'requestId',
      'sessionId',
      'toBranchId',
    ]);
    const text = JSON.stringify(row);
    expect(text).not.toContain(emails.superAdmin);
    expect(text).not.toContain('Person');
    expect(text).not.toContain(sw.body.refreshToken);
    expect(text).not.toContain(sw.body.accessToken);
  });

  // ------------------------------------------------------------ who may switch

  it.each([
    ['branch admin', 'admin'],
    ['receptionist', 'reception'],
    ['nurse', 'nurse'],
  ] as const)('%s gets 403 on list and switch and canSwitchBranch=false', async (_label, key) => {
    const l = await login(codes.main, emails[key]);
    expect((await me(l.accessToken)).body.canSwitchBranch).toBe(false);

    const list = await http()
      .get('/auth/switchable-branches')
      .set('Authorization', `Bearer ${l.accessToken}`);
    expect(list.status).toBe(403);
    expect(list.body.message).toBe(NOT_A_SWITCHER_MESSAGE);

    const sw = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(sw.status).toBe(403);
    // The refresh session is untouched by a refused switch.
    expect((await refresh(l.refreshToken)).status).toBe(200);
    const denied = await owner.auditLog.count({
      where: { tenantId, action: 'AUTH_BRANCH_SWITCH_DENIED', actorUserId: ids[key] },
    });
    expect(denied).toBeGreaterThanOrEqual(1);
  });

  it('a hospital-wide user whose assignment or role was switched off gets 403', async () => {
    const l = await loginSuper();
    await owner.roleAssignment.updateMany({
      where: { userId: ids.superAdmin },
      data: { isActive: false },
    });
    const a = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(a.status).toBe(403);
    await owner.roleAssignment.updateMany({
      where: { userId: ids.superAdmin },
      data: { isActive: true },
    });
    await owner.role.update({ where: { id: ids.superRole }, data: { isActive: false } });
    const b = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(b.status).toBe(403);
  });

  it('a disabled user cannot switch (401, nothing rotated)', async () => {
    const l = await loginSuper();
    await owner.user.update({ where: { id: ids.superAdmin }, data: { isActive: false } });
    const res = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------- token checks

  it('no token = 401; garbage token = 401; expired token = 401', async () => {
    const l = await loginSuper();
    const none = await http()
      .post('/auth/switch-branch')
      .send({ branchId: eastId, refreshToken: l.refreshToken });
    expect(none.status).toBe(401);
    expect((await switchTo('not-a-token', eastId, l.refreshToken)).status).toBe(401);
    const list = await http().get('/auth/switchable-branches');
    expect(list.status).toBe(401);

    const expired = jwt.sign(
      {
        tokenType: 'HOSPITAL',
        tenantId,
        userId: ids.superAdmin,
        branchId: mainId,
        sub: ids.superAdmin,
      },
      process.env.JWT_HOSPITAL_ACCESS_SECRET!,
      { algorithm: 'HS256', expiresIn: -60 },
    );
    expect((await switchTo(expired, eastId, l.refreshToken)).status).toBe(401);
  });

  it('CHANGE_PASSWORD, HQ-secret and wrong-secret tokens are refused', async () => {
    const l = await loginSuper();
    const cp = tokens.signHospitalAccess({
      tenantId,
      userId: ids.superAdmin,
      branchId: mainId,
      tokenType: 'CHANGE_PASSWORD_HOSPITAL',
    });
    expect((await switchTo(cp, eastId, l.refreshToken)).status).toBe(401);

    const hq = tokens.signHqAccess({ userId: ids.superAdmin });
    expect((await switchTo(hq, eastId, l.refreshToken)).status).toBe(401);

    const forged = jwt.sign(
      { tokenType: 'HOSPITAL', tenantId, userId: ids.superAdmin, branchId: mainId },
      'x'.repeat(40),
      { algorithm: 'HS256', expiresIn: 600 },
    );
    expect((await switchTo(forged, eastId, l.refreshToken)).status).toBe(401);
  });

  // ------------------------------------------------------------- target checks

  it('another hospital branch, an unknown id and an inactive branch all get the SAME 404', async () => {
    const l = await loginSuper();
    const cross = await switchTo(l.accessToken, otherBranchId, l.refreshToken);
    const unknown = await switchTo(l.accessToken, 'no-such-branch-id', l.refreshToken);
    const inactive = await switchTo(l.accessToken, westInactiveId, l.refreshToken);
    for (const res of [cross, unknown, inactive]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        statusCode: 404,
        message: BRANCH_NOT_AVAILABLE_MESSAGE,
        error: 'Not Found',
      });
    }
    // Refused attempts do not rotate: the same refresh token still works.
    expect((await refresh(l.refreshToken)).status).toBe(200);
  });

  it('refused attempts are audited with a reason code and never with the supplied id', async () => {
    const l = await loginSuper();
    await switchTo(l.accessToken, otherBranchId, l.refreshToken);
    const rows = await owner.auditLog.findMany({
      where: { tenantId, action: 'AUTH_BRANCH_SWITCH_DENIED', actorUserId: ids.superAdmin },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(otherBranchId);
    expect((rows[0]!.metadata as { reason: string }).reason).toBe('BRANCH_NOT_AVAILABLE');
  });

  it('switching to the branch already active gets 400', async () => {
    const l = await loginSuper();
    const res = await switchTo(l.accessToken, mainId, l.refreshToken);
    expect(res.status).toBe(400);
  });

  it('rejects unknown body fields, missing fields and oversized ids', async () => {
    const l = await loginSuper();
    const auth = { Authorization: `Bearer ${l.accessToken}` };
    const extra = await http().post('/auth/switch-branch').set(auth).send({
      branchId: eastId,
      refreshToken: l.refreshToken,
      tenantId: otherTenantId,
    });
    expect(extra.status).toBe(400);
    expect(
      (await http().post('/auth/switch-branch').set(auth).send({ branchId: eastId })).status,
    ).toBe(400);
    expect(
      (await http().post('/auth/switch-branch').set(auth).send({ refreshToken: l.refreshToken }))
        .status,
    ).toBe(400);
    expect((await switchTo(l.accessToken, 'x'.repeat(65), l.refreshToken)).status).toBe(400);
  });

  it('rejects non-string and structured ids (no query injection through branchId)', async () => {
    const l = await loginSuper();
    const auth = { Authorization: `Bearer ${l.accessToken}` };
    for (const bad of [123, { not: 'x' }, ['a'], null, true]) {
      const res = await http()
        .post('/auth/switch-branch')
        .set(auth)
        .send({ branchId: bad, refreshToken: l.refreshToken });
      expect(res.status).toBe(400);
    }
    expect((await switchTo(l.accessToken, "' OR 1=1 --", l.refreshToken)).status).toBe(404);
  });

  it('a hospital that is no longer active cannot switch (401, nothing rotated)', async () => {
    const l = await loginSuper();
    await owner.hospital.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    try {
      expect((await switchTo(l.accessToken, eastId, l.refreshToken)).status).toBe(401);
    } finally {
      await owner.hospital.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    }
  });

  it('the IP rate limit applies (429 + Retry-After) and Redis down fails closed (503); nothing rotates', async () => {
    const { AuthRateLimitedError } = await import('./auth-redis.service');
    const { ServiceUnavailableException } = await import('@nestjs/common');
    const l = await loginSuper();

    const limited = jest
      .spyOn(redis, 'assertIpAllowed')
      .mockRejectedValueOnce(new AuthRateLimitedError(30));
    const r429 = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(r429.status).toBe(429);
    expect(r429.headers['retry-after']).toBe('30');

    limited.mockRejectedValueOnce(new ServiceUnavailableException());
    const r503 = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(r503.status).toBe(503);
    limited.mockRestore();

    // The refresh token was never consumed by the refused calls.
    const ok = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(ok.status).toBe(200);
  });

  // ------------------------------------------------------- refresh token rules

  it('refresh tokens of another user, another hospital, HQ kind or garbage are refused', async () => {
    const l = await loginSuper();
    const admin = await login(codes.main, emails.admin);
    const other = await login(otherAccessCode, emails.otherSuper);

    const wrongUser = await switchTo(l.accessToken, eastId, admin.refreshToken);
    expect(wrongUser.status).toBe(401);
    const wrongTenant = await switchTo(l.accessToken, eastId, other.refreshToken);
    expect(wrongTenant.status).toBe(401);
    for (const bad of ['garbage', 'q.abc.def', 'p.abc.def', `h.${tenantId}.nope.nope`]) {
      expect((await switchTo(l.accessToken, eastId, bad)).status).toBe(401);
    }
    // Other hospital's access token with this hospital's refresh token.
    const otherAccess = tokens.signHospitalAccess({
      tenantId: otherTenantId,
      userId: ids.otherSuper,
      branchId: otherBranchId,
    });
    expect((await switchTo(otherAccess, eastId, l.refreshToken)).status).toBe(401);
    // None of the refusals touched the real session.
    expect((await refresh(l.refreshToken)).status).toBe(200);
    expect((await refresh(admin.refreshToken)).status).toBe(200);
  });

  it('replaying the old refresh token after a switch is reuse: the whole family is revoked', async () => {
    const l = await loginSuper();
    const sw = await switchTo(l.accessToken, eastId, l.refreshToken);
    expect(sw.status).toBe(200);

    const replay = await switchTo(sw.body.accessToken, mainId, l.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toBe(AUTH_FAILED_MESSAGE);
    expect((await refresh(sw.body.refreshToken)).status).toBe(401);
    const reuse = await owner.auditLog.count({
      where: { tenantId, action: 'AUTH_REFRESH_REUSE', actorUserId: ids.superAdmin },
    });
    expect(reuse).toBeGreaterThanOrEqual(1);
  });

  it('a refresh with the old token after a switch is also reuse', async () => {
    const l = await loginSuper();
    await switchTo(l.accessToken, eastId, l.refreshToken);
    expect((await refresh(l.refreshToken)).status).toBe(401);
  });

  it('a logged-out session cannot be switched', async () => {
    const l = await loginSuper();
    await http().post('/auth/logout').send({ refreshToken: l.refreshToken });
    expect((await switchTo(l.accessToken, eastId, l.refreshToken)).status).toBe(401);
  });

  it('an expired refresh session cannot be switched', async () => {
    const l = await loginSuper();
    await owner.authSession.update({
      where: { id: sessionIdOf(l.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await switchTo(l.accessToken, eastId, l.refreshToken)).status).toBe(401);
  });

  // --------------------------------------------- hospital scope is re-checked

  it('removing hospital scope makes refresh fail and revokes the whole session family', async () => {
    const l = await loginSuper();
    const sw = await switchTo(l.accessToken, eastId, l.refreshToken);
    const sessionId = sessionIdOf(sw.body.refreshToken);
    expect(await liveSessions(sessionId)).toBe(1);

    await owner.roleAssignment.updateMany({
      where: { userId: ids.superAdmin },
      data: { isActive: false },
    });
    const res = await refresh(sw.body.refreshToken);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(AUTH_FAILED_MESSAGE);
    expect(await liveSessions(sessionId)).toBe(0);
    const row = await owner.authSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('deactivating the hospital-wide ROLE also makes refresh fail on a no-membership branch', async () => {
    const l = await loginSuper();
    const sw = await switchTo(l.accessToken, eastId, l.refreshToken);
    await owner.role.update({ where: { id: ids.superRole }, data: { isActive: false } });
    expect((await refresh(sw.body.refreshToken)).status).toBe(401);
    expect(await liveSessions(sessionIdOf(sw.body.refreshToken))).toBe(0);
  });

  it('losing hospital scope does NOT break a session on a branch the user is a member of', async () => {
    const l = await loginSuper();
    await owner.roleAssignment.updateMany({
      where: { userId: ids.superAdmin },
      data: { isActive: false },
    });
    expect((await refresh(l.refreshToken)).status).toBe(200);
  });

  it('losing membership alone does NOT break a hospital-wide session (new rule)', async () => {
    const l = await loginSuper();
    await owner.userBranch.updateMany({
      where: { userId: ids.superAdmin },
      data: { isActive: false },
    });
    expect((await refresh(l.refreshToken)).status).toBe(200);
  });

  it('a branch deactivated after the switch makes the next refresh fail', async () => {
    const l = await loginSuper();
    const sw = await switchTo(l.accessToken, eastId, l.refreshToken);
    await owner.branch.update({ where: { id: eastId }, data: { isActive: false } });
    try {
      expect((await refresh(sw.body.refreshToken)).status).toBe(401);
    } finally {
      await owner.branch.update({ where: { id: eastId }, data: { isActive: true } });
    }
  });

  // ---------------------------------------------------------------- concurrency

  it('many simultaneous switches with the same refresh token: exactly one wins', async () => {
    for (let round = 0; round < 3; round += 1) {
      const l = await loginSuper();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => switchTo(l.accessToken, eastId, l.refreshToken)),
      );
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(7);
      expect(await liveSessions(sessionIdOf(l.refreshToken))).toBeLessThanOrEqual(1);
    }
  });

  it('a switch and a refresh at the same time (same refresh token): exactly one wins', async () => {
    for (let i = 0; i < 3; i += 1) {
      const l = await loginSuper();
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => switchTo(l.accessToken, eastId, l.refreshToken)),
        ...Array.from({ length: 4 }, () => refresh(l.refreshToken)),
      ]);
      expect(results.filter((x) => x.status === 200)).toHaveLength(1);
      expect(await liveSessions(sessionIdOf(l.refreshToken))).toBeLessThanOrEqual(1);
    }
  });

  it('two simultaneous refreshes with one token: exactly one wins (hardened rotation)', async () => {
    const l = await loginSuper();
    const results = await Promise.all(Array.from({ length: 8 }, () => refresh(l.refreshToken)));
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await liveSessions(sessionIdOf(l.refreshToken))).toBeLessThanOrEqual(1);
  });
});
