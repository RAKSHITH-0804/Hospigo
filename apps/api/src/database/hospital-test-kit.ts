import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ensureSystemRolesForTenant } from '../../prisma/seeds/reference';
import { CLOCK, type Clock } from '../common/clock';
import type { TokenService } from '../modules/auth/token.service';
import { createOwnerPrisma } from './db-test.util';

/**
 * Shared set-up of the HTTP specs of Step 8c: the test environment, a booted app, and hospitals
 * with branches and people. Everything runs on hospigo_test only (the set-up refuses any other
 * owner database).
 */

export type OwnerPrisma = ReturnType<typeof createOwnerPrisma>;

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the HTTP specs`);
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

/** Call at the top of a spec, before the app module is imported. */
export function prepareTestEnv(): void {
  loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
  loadEnv({ path: path.resolve(process.cwd(), '.env') });
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
}

export type BootedApp = { app: INestApplication; tokens: TokenService };

/** The whole app on the test database; the clock (every module's CLOCK) is the one given. */
export async function bootApp(clock: Clock): Promise<BootedApp> {
  const { AppModule } = await import('../app.module');
  const { TokenService: TokenServiceClass } = await import('../modules/auth/token.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return { app, tokens: app.get(TokenServiceClass) };
}

export type KitHospital = {
  tenant: string;
  code: string;
  main: string;
  east: string;
  superAdminRoleId: string;
  branchAdminRoleId: string;
  /** The Indigo Owner role (Step 2.1b): the only one that changes print templates and logos. */
  ownerRoleId: string;
};

export type KitPerson = { id: string; token: (branchId: string) => string };

export type PersonRole =
  | { roleId: string; scope: 'HOSPITAL' | 'BRANCH' }
  | { permissions: readonly string[]; scope: 'BRANCH' };

/** Hospitals and people for a spec. */
export function createKit(owner: OwnerPrisma, tokens: TokenService) {
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}${stamp}${(seq += 1)}`;

  /** A hospital with a main branch and an East branch, the OPD module on, OPD settings, system roles. */
  async function hospital(label: string): Promise<KitHospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const created = await owner.hospital.create({
      data: {
        code: `K8C_${label}_${stamp}`,
        name: `Kit ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: uniq(`k8c-${label}-m-`) },
            { code: 'EAST', name: 'East', accessCode: uniq(`k8c-${label}-e-`) },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = created.id;
    const main = created.branches.find((b) => b.code === 'MAIN')!.id;
    const east = created.branches.find((b) => b.code === 'EAST')!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    for (const branchId of [main, east]) {
      await owner.branchModule.create({
        data: { tenantId: tenant, branchId, moduleId: opd.id, enabledByIndigo: true },
      });
    }
    await owner.opdSettings.create({
      data: { tenantId: tenant, followUpFreeDays: 7, tokenPrefix: 'T', timezone: 'Asia/Kolkata' },
    });
    const { superAdminRoleId, branchAdminRoleId, ownerRoleId } = await ensureSystemRolesForTenant(
      owner,
      tenant,
    );
    return {
      tenant,
      code: created.code,
      main,
      east,
      superAdminRoleId,
      branchAdminRoleId,
      ownerRoleId,
    };
  }

  /** A person working in the given branches, with a system role or a role made of the given permissions. */
  async function person(
    h: KitHospital,
    key: string,
    branches: string[],
    role?: PersonRole,
  ): Promise<KitPerson> {
    const u = await owner.user.create({
      data: {
        tenantId: h.tenant,
        code: `${key}${stamp}${(seq += 1)}`.slice(0, 40),
        email: `${uniq(key)}@example.test`,
        displayName: `Person ${key}`,
        passwordHash: 'x',
      },
    });
    for (const branchId of branches) {
      await owner.userBranch.create({ data: { tenantId: h.tenant, userId: u.id, branchId } });
    }
    let roleId = role && 'roleId' in role ? role.roleId : undefined;
    if (role && 'permissions' in role) {
      const perms = await owner.permission.findMany({
        where: { code: { in: [...role.permissions] } },
      });
      const made = await owner.role.create({
        data: { tenantId: h.tenant, code: uniq(`R_${key}_`), name: key },
      });
      for (const p of perms) {
        await owner.rolePermission.create({
          data: { tenantId: h.tenant, roleId: made.id, permissionId: p.id },
        });
      }
      roleId = made.id;
    }
    if (roleId && role) {
      const a = await owner.roleAssignment.create({
        data: { tenantId: h.tenant, userId: u.id, roleId, scopeType: role.scope },
      });
      if (role.scope === 'BRANCH') {
        for (const branchId of branches) {
          await owner.roleAssignmentBranch.create({
            data: { tenantId: h.tenant, assignmentId: a.id, branchId },
          });
        }
      }
    }
    return {
      id: u.id,
      token: (branchId: string) =>
        tokens.signHospitalAccess({ tenantId: h.tenant, userId: u.id, branchId }),
    };
  }

  /** The usual cast: SuperAdmin (hospital-wide), Branch Admin of Main, a person with no role. */
  async function cast(h: KitHospital) {
    const admin = await person(h, 'sa', [h.main, h.east], {
      roleId: h.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    const branchAdmin = await person(h, 'ba', [h.main], {
      roleId: h.branchAdminRoleId,
      scope: 'BRANCH',
    });
    const nobody = await person(h, 'nobody', [h.main]);
    return {
      admin: admin.token(h.main),
      adminId: admin.id,
      branchAdmin: branchAdmin.token(h.main),
      branchAdminId: branchAdmin.id,
      nobody: nobody.token(h.main),
    };
  }

  return { stamp, uniq, hospital, person, cast };
}
