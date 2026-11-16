/**
 * GET /auth/me permissions[] for the active branch (Phase 2 Step 3b).
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

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: requireAppTestDatabaseUrl(),
  DATABASE_URL_OWNER: requireOwnerTestDatabaseUrl(),
  DATABASE_URL_HQ: rewriteToTestDb('DATABASE_URL_HQ'),
  DATABASE_URL_PATIENT: rewriteToTestDb('DATABASE_URL_PATIENT'),
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

const TEST_PREFIX = 'hospigo:auth:me:perms:';

describe('GET /auth/me permissions (HTTP)', () => {
  const owner = createOwnerPrisma();
  let app: INestApplication;
  let redis: import('./auth-redis.service').AuthRedisService;
  let password: string;
  let accessMain: string;
  let accessEast: string;
  let recvEmail: string;
  let nurseEmail: string;
  let adminEmail: string;
  let branchOnlyEmail: string;
  let hqEmail: string;
  let tenantId: string;
  let mainId: string;
  let eastId: string;
  let inactivePermCode: string;

  beforeAll(async () => {
    const stamp = Date.now();
    password = 'CorrectHorse9!';
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    accessMain = `me-perm-${stamp}`;
    accessEast = `me-perm-e-${stamp}`;
    recvEmail = `me_recv_${stamp}@example.test`;
    nurseEmail = `me_nurse_${stamp}@example.test`;
    adminEmail = `me_admin_${stamp}@example.test`;
    branchOnlyEmail = `me_branch_${stamp}@example.test`;
    hqEmail = `me_hq_${stamp}@example.test`;
    inactivePermCode = `inactive.perm.${stamp}`;

    for (const code of [
      'patients.registry.read',
      'patients.registry.write',
      'hospital.settings.write',
      'opd.masters.read',
      inactivePermCode,
    ]) {
      await owner.permission.upsert({
        where: { code },
        create: { code, description: code, isActive: code !== inactivePermCode },
        update: { isActive: code !== inactivePermCode },
      });
    }
    // Ensure inactive stays inactive
    await owner.permission.update({
      where: { code: inactivePermCode },
      data: { isActive: false },
    });

    const perms = await owner.permission.findMany({
      where: {
        code: {
          in: [
            'patients.registry.read',
            'patients.registry.write',
            'hospital.settings.write',
            'opd.masters.read',
            inactivePermCode,
          ],
        },
      },
    });
    const byCode = Object.fromEntries(perms.map((p) => [p.code, p.id]));

    const hospital = await owner.hospital.create({
      data: {
        code: `ME_P_${stamp}`,
        name: 'Me Perms Hospital',
        isTest: true,
        status: 'ACTIVE',
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: accessMain },
            { code: 'EAST', name: 'East', isMain: false, accessCode: accessEast },
          ],
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;
    mainId = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    eastId = hospital.branches.find((b) => b.code === 'EAST')!.id;

    const roleAdmin = await owner.role.create({
      data: { tenantId, code: 'BRANCH_ADMIN', name: 'Branch Admin', isSystem: true },
    });
    for (const code of [
      'patients.registry.read',
      'patients.registry.write',
      'hospital.settings.write',
      'opd.masters.read',
      inactivePermCode,
    ]) {
      await owner.rolePermission.create({
        data: { tenantId, roleId: roleAdmin.id, permissionId: byCode[code]! },
      });
    }

    const roleRecv = await owner.role.create({
      data: { tenantId, code: 'RECEPTIONIST', name: 'Receptionist' },
    });
    for (const code of ['patients.registry.read', 'patients.registry.write', 'opd.masters.read']) {
      await owner.rolePermission.create({
        data: { tenantId, roleId: roleRecv.id, permissionId: byCode[code]! },
      });
    }

    const roleNurse = await owner.role.create({
      data: { tenantId, code: 'NURSE', name: 'Nurse' },
    });
    for (const code of ['patients.registry.read', 'opd.masters.read']) {
      await owner.rolePermission.create({
        data: { tenantId, roleId: roleNurse.id, permissionId: byCode[code]! },
      });
    }

    const roleEastOnly = await owner.role.create({
      data: { tenantId, code: 'EAST_DESK', name: 'East Desk' },
    });
    await owner.rolePermission.create({
      data: {
        tenantId,
        roleId: roleEastOnly.id,
        permissionId: byCode['patients.registry.write']!,
      },
    });

    async function makeUser(
      code: string,
      email: string,
      roleId: string,
      scope: 'HOSPITAL' | 'BRANCH',
      membershipBranchIds: string[],
      assignmentBranchIds?: string[],
    ) {
      const user = await owner.user.create({
        data: {
          tenantId,
          code,
          email,
          displayName: code,
          passwordHash: hash,
          mustChangePassword: false,
        },
      });
      for (const branchId of membershipBranchIds) {
        await owner.userBranch.create({ data: { tenantId, userId: user.id, branchId } });
      }
      const assignment = await owner.roleAssignment.create({
        data: {
          tenantId,
          userId: user.id,
          roleId,
          scopeType: scope,
        },
      });
      if (scope === 'BRANCH') {
        for (const branchId of assignmentBranchIds ?? membershipBranchIds) {
          await owner.roleAssignmentBranch.create({
            data: {
              tenantId,
              assignmentId: assignment.id,
              branchId,
            },
          });
        }
      }
      return user;
    }

    await makeUser('ADM', adminEmail, roleAdmin.id, 'HOSPITAL', [mainId, eastId]);
    await makeUser('RC1', recvEmail, roleRecv.id, 'HOSPITAL', [mainId, eastId]);
    await makeUser('NU1', nurseEmail, roleNurse.id, 'HOSPITAL', [mainId]);
    // Membership on both branches; BRANCH-scoped role only on East.
    await makeUser('BE1', branchOnlyEmail, roleEastOnly.id, 'BRANCH', [mainId, eastId], [eastId]);

    await owner.hqUser.create({
      data: {
        email: hqEmail,
        displayName: 'HQ',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
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
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await redis.clearPrefixKeys();
  });

  async function login(accessCode: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/hospital/login')
      .send({ accessCode, email, password })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function me(token: string) {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as { permissions: string[] };
  }

  it('Receptionist, Nurse and Branch Admin get the right permission lists', async () => {
    const recv = await me(await login(accessMain, recvEmail));
    expect(recv.permissions).toEqual(
      ['opd.masters.read', 'patients.registry.read', 'patients.registry.write'].sort(),
    );

    const nurse = await me(await login(accessMain, nurseEmail));
    expect(nurse.permissions).toEqual(['opd.masters.read', 'patients.registry.read'].sort());
    expect(nurse.permissions).not.toContain('patients.registry.write');

    const admin = await me(await login(accessMain, adminEmail));
    expect(admin.permissions).toEqual(
      expect.arrayContaining([
        'hospital.settings.write',
        'patients.registry.read',
        'patients.registry.write',
        'opd.masters.read',
      ]),
    );
    expect(admin.permissions).not.toContain(inactivePermCode);
  });

  it('branch-scoped role only exposes that branch permissions for the active branch', async () => {
    const onEast = await me(await login(accessEast, branchOnlyEmail));
    expect(onEast.permissions).toEqual(['patients.registry.write']);

    const onMain = await me(await login(accessMain, branchOnlyEmail));
    expect(onMain.permissions).toEqual([]);
  });

  it('HQ gets an empty permissions array', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/hq/login')
      .send({ email: hqEmail, password })
      .expect(200);
    const body = await me(loginRes.body.accessToken as string);
    expect(body.permissions).toEqual([]);
  });

  it('inactive role or permission is absent', async () => {
    const admin = await me(await login(accessMain, adminEmail));
    expect(admin.permissions).not.toContain(inactivePermCode);

    await owner.role.update({
      where: { tenantId_code: { tenantId, code: 'NURSE' } },
      data: { isActive: false },
    });
    const nurse = await me(await login(accessMain, nurseEmail));
    expect(nurse.permissions).toEqual([]);
    await owner.role.update({
      where: { tenantId_code: { tenantId, code: 'NURSE' } },
      data: { isActive: true },
    });
  });
});
