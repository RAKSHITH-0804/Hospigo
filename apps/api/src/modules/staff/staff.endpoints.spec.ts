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
import { ensureSystemRolesForTenant } from '../../../prisma/seeds/reference';
import { MailProcessor } from '../mail/mail.processor';
import { MailService } from '../mail/mail.service';
import { AuthRedisService } from '../auth/auth-redis.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the staff tests`);
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

type Hospital = {
  tenant: string;
  main: string;
  east: string;
  superRoleId: string;
  branchAdminRoleId: string;
  tokens: Record<string, string>;
  users: Record<string, string>;
};

const READER_CODES = ['user.read', 'role.read'] as const;
const NURSE_CODES = ['opd.queue.read'] as const;

describe('staff and roles (HTTP)', () => {
  jest.setTimeout(180_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const activations: Array<{ kind: string; tenantId: string | null; userId: string }> = [];
  let failEnqueue = false;
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  let redis: AuthRedisService;
  const stamp = Date.now();
  let seq = 0;
  let A: Hospital;
  let B: Hospital;
  const email = (tag: string) => `st_${tag}_${stamp}_${(seq += 1)}@example.test`;

  async function seedHospital(label: string, withEast: boolean): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `ST_${label}_${stamp}`,
        name: `Staff ${label}`,
        isTest: true,
        branches: {
          create: [
            {
              code: 'MAIN',
              name: 'Main Branch',
              isMain: true,
              accessCode: `st-${label}-m-${stamp}`,
            },
            ...(withEast
              ? [
                  {
                    code: 'EAST',
                    name: 'East Branch',
                    isMain: false,
                    accessCode: `st-${label}-e-${stamp}`,
                  },
                ]
              : []),
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const main = hospital.branches.find((b) => b.isMain)!.id;
    const east = hospital.branches.find((b) => !b.isMain)?.id ?? '';
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    for (const branchId of [main, east].filter(Boolean)) {
      await owner.branchModule.create({
        data: { tenantId: tenant, branchId, moduleId: opd.id, enabledByIndigo: true },
      });
    }
    const { superAdminRoleId, branchAdminRoleId } = await ensureSystemRolesForTenant(owner, tenant);
    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};

    async function person(
      key: string,
      branches: string[],
      assignment:
        { roleId: string; scope: 'HOSPITAL' | 'BRANCH' } | { codes: readonly string[] } | null,
    ) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: email(`${key}${label}`),
          displayName: `Person ${key} ${label}`,
          passwordHash: 'x',
          passwordChangedAt: new Date(),
        },
      });
      for (const branchId of branches) {
        await owner.userBranch.create({ data: { tenantId: tenant, userId: u.id, branchId } });
      }
      if (assignment) {
        let roleId: string;
        let scope: 'HOSPITAL' | 'BRANCH' = 'BRANCH';
        if ('roleId' in assignment) {
          roleId = assignment.roleId;
          scope = assignment.scope;
        } else {
          scope = assignment.scope ?? 'BRANCH';
          const role = await owner.role.create({
            data: { tenantId: tenant, code: `R_${key}_${stamp}`, name: `Role ${key} ${label}` },
          });
          const perms = await owner.permission.findMany({
            where: { code: { in: [...assignment.codes] } },
          });
          for (const p of perms) {
            await owner.rolePermission.create({
              data: { tenantId: tenant, roleId: role.id, permissionId: p.id },
            });
          }
          roleId = role.id;
        }
        const a = await owner.roleAssignment.create({
          data: { tenantId: tenant, userId: u.id, roleId, scopeType: scope },
        });
        if (scope === 'BRANCH') {
          for (const branchId of branches) {
            await owner.roleAssignmentBranch.create({
              data: { tenantId: tenant, assignmentId: a.id, branchId },
            });
          }
        }
      }
      users[key] = u.id;
      tokens[key] = tokenService.signHospitalAccess({
        tenantId: tenant,
        userId: u.id,
        branchId: branches[0] ?? main,
      });
    }

    await person('sa', [main, east].filter(Boolean), {
      roleId: superAdminRoleId,
      scope: 'HOSPITAL',
    });
    await person('adminMain', [main], { roleId: branchAdminRoleId, scope: 'BRANCH' });
    if (withEast) {
      await person('adminEast', [east], { roleId: branchAdminRoleId, scope: 'BRANCH' });
    }
    await person('reader', [main], { codes: READER_CODES });
    await person('nurse', [main], { codes: NURSE_CODES });
    await person('nobody', [main], null);
    return { tenant, main, east, superRoleId: superAdminRoleId, branchAdminRoleId, tokens, users };
  }

  beforeAll(async () => {
    const { AppModule } = await import('../../app.module');
    const { TokenService } = await import('../auth/token.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MailService)
      .useValue({
        enqueue: async (job: { kind: string; tenantId: string | null; userId: string }) => {
          if (failEnqueue) {
            throw new Error('mail down');
          }
          activations.push(job);
        },
        onModuleDestroy: async () => undefined,
      })
      .overrideProvider(MailProcessor)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    tokenService = app.get(TokenService);
    redis = app.get(AuthRedisService);
    redis.setKeyPrefix(`staff-test-${stamp}:`);
    A = await seedHospital('A', true);
    B = await seedHospital('B', false);
  });

  afterAll(async () => {
    await redis.clearPrefixKeys();
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    failEnqueue = false;
    activations.length = 0;
    await redis.clearPrefixKeys();
  });

  const http = () => request(app.getHttpServer());
  type Method = 'get' | 'post' | 'put';
  const call = (method: Method, h: Hospital, who: string, url: string, body?: unknown) =>
    (http() as Loose)
      [method](url)
      .set({ Authorization: `Bearer ${h.tokens[who]}` })
      .send(body ?? {});
  const get = (h: Hospital, who: string, url: string) => call('get', h, who, url);
  const post = (h: Hospital, who: string, url: string, body?: unknown) =>
    call('post', h, who, url, body);
  const put = (h: Hospital, who: string, url: string, body?: unknown) =>
    call('put', h, who, url, body);
  const audits = (h: Hospital, action: string) =>
    owner.auditLog.findMany({
      where: { tenantId: h.tenant, action },
      orderBy: { createdAt: 'asc' },
    });
  const invalid = (res: Loose, field: string, reason?: string) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SETTINGS_INVALID');
    expect(res.body.field).toBe(field);
    if (reason) expect(res.body.reason).toBe(reason);
  };
  const conflict = (res: Loose, reason: string) => {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STAFF_CONFLICT');
    expect(res.body.reason).toBe(reason);
  };

  /** A custom role made through the API (so the real checks run). */
  async function makeRole(h: Hospital, name: string, permissionCodes: string[], who = 'sa') {
    const res = await post(h, who, '/roles', { name, permissionCodes });
    expect({ status: res.status, body: res.status === 201 ? 'ok' : res.body }).toEqual({
      status: 201,
      body: 'ok',
    });
    return res.body as Loose;
  }
  const FLOOR_RECEPTION = [
    'patients.registry.read',
    'patients.registry.write',
    'opd.visits.create',
  ];
  async function makeStaff(
    h: Hospital,
    who: string,
    over: Record<string, unknown> = {},
    roleId?: string,
  ) {
    const role = roleId ?? (await makeRole(h, `Reception ${email('r')}`, FLOOR_RECEPTION)).id;
    return post(h, who, '/staff', {
      name: 'New Person',
      email: email('new'),
      branchIds: [h.main],
      roles: [{ roleId: role }],
      ...over,
    });
  }

  describe('access', () => {
    const ROUTES: Array<[Method, string]> = [
      ['get', '/staff'],
      ['get', '/staff/options'],
      ['get', '/staff/code-format'],
      ['put', '/staff/code-format'],
      ['post', '/staff'],
      ['put', '/staff/some-id'],
      ['post', '/staff/some-id/deactivate'],
      ['post', '/staff/some-id/reactivate'],
      ['post', '/staff/some-id/resend-invite'],
      ['get', '/roles'],
      ['get', '/roles/catalog'],
      ['get', '/roles/templates'],
      ['post', '/roles'],
      ['put', '/roles/some-id'],
      ['post', '/roles/some-id/deactivate'],
      ['post', '/roles/some-id/reactivate'],
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

    it('someone without staff permissions gets 403 on every route', async () => {
      for (const who of ['nurse', 'nobody']) {
        for (const [method, url] of ROUTES) {
          const res = await call(method, A, who, url, {});
          expect({ who, url, status: res.status }).toEqual({ who, url, status: 403 });
        }
      }
    });

    it('a reader can look but not change anything', async () => {
      for (const url of [
        '/staff',
        '/staff/options',
        '/staff/code-format',
        '/roles',
        '/roles/catalog',
        '/roles/templates',
      ]) {
        expect({ url, status: (await get(A, 'reader', url)).status }).toEqual({ url, status: 200 });
      }
      for (const [method, url] of ROUTES.filter(([m]) => m !== 'get')) {
        const res = await call(method, A, 'reader', url, {});
        expect({ url, status: res.status }).toEqual({ url, status: 403 });
      }
      const options = await get(A, 'reader', '/staff/options');
      expect(options.body.canWrite).toBe(false);
    });

    it('a Branch Admin manages staff but cannot make or change roles, or the code format', async () => {
      expect((await get(A, 'adminMain', '/staff')).status).toBe(200);
      expect((await get(A, 'adminMain', '/roles')).status).toBe(200);
      expect(
        (await post(A, 'adminMain', '/roles', { name: 'X', permissionCodes: ['opd.visits.read'] }))
          .status,
      ).toBe(403);
      expect(
        (await put(A, 'adminMain', '/staff/code-format', { prefix: 'ZZ', minWidth: 4 })).status,
      ).toBe(403);
      expect((await get(A, 'adminMain', '/roles')).body.canWrite).toBe(false);
      expect((await get(A, 'sa', '/roles')).body.canWrite).toBe(true);
    });
  });

  describe('roles', () => {
    it('lists the system roles first, with the permissions each holds and how many people hold it', async () => {
      const res = await get(A, 'sa', '/roles');
      expect(res.status).toBe(200);
      const system = res.body.items.filter((r: Loose) => r.isSystem).map((r: Loose) => r.code);
      expect(system.sort()).toEqual(['BRANCH_ADMIN', 'SUPER_ADMIN']);
      const superRole = res.body.items.find((r: Loose) => r.code === 'SUPER_ADMIN');
      expect(superRole.permissionCodes).toContain('user.write');
      expect(superRole.assignedCount).toBeGreaterThanOrEqual(1);
      const branchAdmin = res.body.items.find((r: Loose) => r.code === 'BRANCH_ADMIN');
      expect(branchAdmin.permissionCodes).not.toContain('role.write');
      expect(res.body.limits.maxCustomRoles).toBe(50);
    });

    it('offers the catalog of permissions with descriptions, and ready-made templates that exist in it', async () => {
      const catalog = await get(A, 'sa', '/roles/catalog');
      const codes = catalog.body.items.map((p: Loose) => p.code);
      expect(codes).toEqual(
        expect.arrayContaining(['user.write', 'opd.queue.read', 'opd.doctors.own']),
      );
      for (const item of catalog.body.items) {
        expect(item.description.length).toBeGreaterThan(3);
        expect(item.group).toBe(item.code.split('.')[0]);
      }
      const templates = await get(A, 'sa', '/roles/templates');
      expect(templates.body.items.map((t: Loose) => t.key)).toEqual([
        'RECEPTIONIST',
        'NURSE',
        'DOCTOR',
      ]);
      for (const t of templates.body.items) {
        expect(t.permissionCodes.length).toBeGreaterThan(3);
        for (const code of t.permissionCodes) expect(codes).toContain(code);
      }
    });

    it('a SuperAdmin makes a role by choosing permissions, and it is a custom, switched-on role', async () => {
      const res = await post(A, 'sa', '/roles', {
        name: '  Lab   technician ',
        description: 'Takes samples',
        permissionCodes: ['opd.investigations.bill', 'opd.queue.read'],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Lab technician',
        description: 'Takes samples',
        isSystem: false,
        isActive: true,
        assignedCount: 0,
        permissionCodes: ['opd.investigations.bill', 'opd.queue.read'],
      });
      expect(res.body.code).toMatch(/^CUSTOM_LAB_TECHNICIAN/);
      const trail = await audits(A, 'ROLE_CREATE');
      expect(trail.at(-1)!.metadata).toEqual({ permissionCount: 2 });
    });

    it('refuses bad roles with the field and the reason', async () => {
      const make = (b: unknown) => post(A, 'sa', '/roles', b);
      invalid(await make([]), 'body', 'REQUIRED');
      invalid(await make({ permissionCodes: ['opd.queue.read'] }), 'name', 'REQUIRED');
      invalid(
        await make({ name: 'x'.repeat(61), permissionCodes: ['opd.queue.read'] }),
        'name',
        'TOO_LONG',
      );
      invalid(await make({ name: 'N1' }), 'permissionCodes', 'REQUIRED');
      invalid(await make({ name: 'N2', permissionCodes: [] }), 'permissionCodes', 'REQUIRED');
      invalid(
        await make({ name: 'N3', permissionCodes: ['opd.queue.read', 'opd.queue.read'] }),
        'permissionCodes',
        'DUPLICATE',
      );
      invalid(
        await make({ name: 'N4', permissionCodes: ['not.a.permission'] }),
        'permissionCodes.0',
        'UNKNOWN',
      );
      invalid(
        await make({ name: 'N5', permissionCodes: ["x'; drop table roles;--"] }),
        'permissionCodes.0',
        'INVALID',
      );
      invalid(await make({ name: 'N6', permissionCodes: [5] }), 'permissionCodes.0', 'INVALID');
      invalid(
        await make({
          name: 'Nurse',
          description: 'd'.repeat(201),
          permissionCodes: ['opd.queue.read'],
        }),
        'description',
        'TOO_LONG',
      );
      await makeRole(A, 'Unique role name', ['opd.queue.read']);
      invalid(
        await make({ name: 'UNIQUE ROLE NAME', permissionCodes: ['opd.queue.read'] }),
        'name',
        'DUPLICATE',
      );
      invalid(
        await make({ name: 'Super Admin', permissionCodes: ['opd.queue.read'] }),
        'name',
        'DUPLICATE',
      );
    });

    it('changes the name, description and permissions of a custom role; the change counts are audited', async () => {
      const role = await makeRole(A, 'Editable role', ['opd.queue.read', 'opd.vitals.read']);
      const res = await put(A, 'sa', `/roles/${role.id}`, {
        name: 'Edited role',
        permissionCodes: ['opd.queue.read', 'opd.notes.read', 'opd.visits.read'],
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Edited role');
      expect(res.body.permissionCodes).toEqual([
        'opd.notes.read',
        'opd.queue.read',
        'opd.visits.read',
      ]);
      const rows = await owner.rolePermission.findMany({
        where: { roleId: role.id },
        include: { permission: true },
      });
      expect(rows.find((r) => r.permission.code === 'opd.vitals.read')!.isActive).toBe(false); // switched off, not deleted
      const trail = (await audits(A, 'ROLE_CHANGE')).at(-1)!;
      expect(trail.metadata).toEqual({ changed: ['name', 'permissions'], added: 2, removed: 1 });
      // adding back reuses the switched-off row
      const back = await put(A, 'sa', `/roles/${role.id}`, {
        permissionCodes: ['opd.vitals.read'],
      });
      expect(back.body.permissionCodes).toEqual(['opd.vitals.read']);
      const all = await owner.rolePermission.findMany({ where: { roleId: role.id } });
      expect(new Set(all.map((r) => r.permissionId)).size).toBe(all.length);
    });

    it('system roles cannot be changed or switched off; another hospital role is 404; bad bodies are refused', async () => {
      conflict(await put(A, 'sa', `/roles/${A.superRoleId}`, { name: 'Hacked' }), 'SYSTEM_ROLE');
      conflict(await post(A, 'sa', `/roles/${A.branchAdminRoleId}/deactivate`), 'SYSTEM_ROLE');
      expect((await owner.role.findUniqueOrThrow({ where: { id: A.superRoleId } })).name).toBe(
        'Super Admin',
      );
      expect((await put(A, 'sa', `/roles/${B.superRoleId}`, { name: 'x' })).status).toBe(404);
      expect((await put(A, 'sa', '/roles/no-such-role', { name: 'x' })).status).toBe(404);
      const role = await makeRole(A, 'Body checks', ['opd.queue.read']);
      invalid(await put(A, 'sa', `/roles/${role.id}`, {}), 'body', 'REQUIRED');
      invalid(
        await put(A, 'sa', `/roles/${role.id}`, { name: 'Super Admin' }),
        'name',
        'DUPLICATE',
      );
      invalid(
        await put(A, 'sa', `/roles/${role.id}`, { permissionCodes: [] }),
        'permissionCodes',
        'REQUIRED',
      );
    });

    it('a role that people hold cannot be switched off; an unused one can, and can come back', async () => {
      const role = await makeRole(A, 'In use role', FLOOR_RECEPTION);
      const staff = await makeStaff(A, 'sa', {}, role.id);
      expect(staff.status).toBe(201);
      conflict(await post(A, 'sa', `/roles/${role.id}/deactivate`), 'ROLE_IN_USE');
      const spare = await makeRole(A, 'Spare role', ['opd.queue.read']);
      const off = await post(A, 'sa', `/roles/${spare.id}/deactivate`);
      expect(off.body.isActive).toBe(false);
      // a switched-off role is not offered and cannot be given
      const options = await get(A, 'sa', '/staff/options');
      expect(options.body.roles.map((r: Loose) => r.id)).not.toContain(spare.id);
      const created = await makeStaff(A, 'sa', {}, spare.id);
      invalid(created, 'roles.0.roleId', 'INVALID');
      expect((await post(A, 'sa', `/roles/${spare.id}/reactivate`)).body.isActive).toBe(true);
    });

    it('a Branch Admin cannot give a role that holds an administrative power they do not hold', async () => {
      const strong = await makeRole(A, 'Strong role', ['opd.queue.read', 'role.write']);
      const weak = await makeRole(A, 'Floor role', ['opd.queue.read', 'opd.notes.read']);
      const options = await get(A, 'adminMain', '/staff/options');
      const byId = Object.fromEntries(options.body.roles.map((r: Loose) => [r.id, r]));
      expect(byId[strong.id]).toMatchObject({ assignable: false, reason: 'NOT_GRANTABLE' });
      expect(byId[weak.id]).toMatchObject({ assignable: true, reason: null });
      expect(byId[A.superRoleId]).toMatchObject({ assignable: false, reason: 'SYSTEM_ROLE' });
      invalid(await makeStaff(A, 'adminMain', {}, strong.id), 'roles.0.roleId', 'NOT_ALLOWED');
      expect((await makeStaff(A, 'adminMain', {}, weak.id)).status).toBe(201);
    });

    it('another hospital never sees or touches these roles', async () => {
      const mine = await makeRole(A, 'Hospital A only', ['opd.queue.read']);
      const theirs = await get(B, 'sa', '/roles');
      expect(theirs.body.items.map((r: Loose) => r.id)).not.toContain(mine.id);
      expect((await post(B, 'sa', `/roles/${mine.id}/deactivate`)).status).toBe(404);
      expect((await owner.role.findUniqueOrThrow({ where: { id: mine.id } })).isActive).toBe(true);
    });
  });

  describe('staff code format', () => {
    it('starts as STF001 style, can be changed by a hospital-wide Admin, and the number keeps counting', async () => {
      const first = await get(B, 'sa', '/staff/code-format');
      expect(first.body).toMatchObject({ prefix: 'STF', minWidth: 3, next: 'STF001' });
      const role = await makeRole(B, 'Code test role', FLOOR_RECEPTION);
      const one = await makeStaff(B, 'sa', {}, role.id);
      expect(one.body.staff.code).toBe('STF001');
      const changed = await put(B, 'sa', '/staff/code-format', { prefix: 'hosp', minWidth: 5 });
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({ prefix: 'HOSP', minWidth: 5, next: 'HOSP00002' });
      const two = await makeStaff(B, 'sa', {}, role.id);
      expect(two.body.staff.code).toBe('HOSP00002');
      expect((await audits(B, 'STAFF_CODE_FORMAT_CHANGE')).at(-1)!.metadata).toEqual({
        changed: ['prefix', 'minWidth'],
      });
    });

    it('refuses a bad format and never repeats a code already used', async () => {
      const put2 = (b: unknown) => put(A, 'sa', '/staff/code-format', b);
      invalid(await put2({}), 'prefix', 'REQUIRED');
      invalid(await put2({ prefix: '', minWidth: 3 }), 'prefix', 'REQUIRED');
      invalid(await put2({ prefix: 'TOOLONGX', minWidth: 3 }), 'prefix', 'TOO_LONG');
      invalid(await put2({ prefix: 'A-B', minWidth: 3 }), 'prefix', 'INVALID');
      invalid(await put2({ prefix: 'AB', minWidth: 0 }), 'minWidth', 'INVALID');
      invalid(await put2({ prefix: 'AB', minWidth: 9 }), 'minWidth', 'INVALID');
      invalid(await put2({ prefix: 'AB', minWidth: 2.5 }), 'minWidth', 'INVALID');
      invalid(await put2({ prefix: 'AB', minWidth: '3' }), 'minWidth', 'INVALID');
      // a code typed in an older setup is skipped
      await put2({ prefix: 'SKIP', minWidth: 2 });
      const settings = await owner.staffCodeSettings.findUniqueOrThrow({
        where: { tenantId: A.tenant },
      });
      await owner.user.create({
        data: {
          tenantId: A.tenant,
          code: `SKIP${String(Number(settings.lastNumber) + 1).padStart(2, '0')}`,
          email: email('taken'),
          displayName: 'Old code',
          passwordHash: 'x',
        },
      });
      const made = await makeStaff(A, 'sa');
      expect(made.body.staff.code).toBe(
        `SKIP${String(Number(settings.lastNumber) + 2).padStart(2, '0')}`,
      );
    });
  });

  describe('adding staff', () => {
    it('a SuperAdmin adds a person: they are invited by email, switched on, with the roles and branches given', async () => {
      const role = await makeRole(A, 'Reception for add', FLOOR_RECEPTION);
      const res = await post(A, 'sa', '/staff', {
        name: '  Asha   Rao ',
        email: '  Asha.Rao@Example.TEST ',
        phone: '+91 98765 43210',
        branchIds: [A.main],
        roles: [{ roleId: role.id }],
      });
      expect(res.status).toBe(201);
      expect(res.body.activationSent).toBe(true);
      expect(res.body.staff).toMatchObject({
        name: 'Asha Rao',
        email: 'asha.rao@example.test',
        phone: '+91 98765 43210',
        status: 'INVITED',
        editable: true,
        isYou: false,
        doctorCode: null,
      });
      expect(res.body.staff.code).toMatch(/^[A-Z0-9]+\d+$/);
      expect(res.body.staff.branches).toEqual([{ id: A.main, name: 'Main Branch' }]);
      expect(res.body.staff.roles[0]).toMatchObject({
        roleId: role.id,
        scope: 'BRANCH',
        branchIds: [A.main],
      });
      expect(activations).toEqual([
        { kind: 'ACTIVATION', tenantId: A.tenant, userId: res.body.staff.id },
      ]);
      const row = await owner.user.findUniqueOrThrow({ where: { id: res.body.staff.id } });
      expect(row.mustChangePassword).toBe(true);
      expect(row.passwordChangedAt).toBeNull();
      expect(row.passwordHash).toMatch(/^\$argon2/); // an unusable random password, never a known one
      const trail = (await audits(A, 'STAFF_CREATE')).at(-1)!;
      expect(trail.actorUserId).toBe(A.users.sa);
      expect(JSON.stringify(trail.metadata)).not.toMatch(/Asha|asha|98765/);
    });

    it('a failed email queue still creates the person and says the email was not sent', async () => {
      failEnqueue = true;
      const res = await makeStaff(A, 'sa');
      expect(res.status).toBe(201);
      expect(res.body.activationSent).toBe(false);
      expect(res.body.staff.status).toBe('INVITED');
    });

    it('refuses every wrong input with the field and the reason, and creates nobody', async () => {
      const users = await owner.user.count({ where: { tenantId: A.tenant } });
      const role = await makeRole(A, 'Validation role', FLOOR_RECEPTION);
      const good = {
        name: 'Valid Person',
        email: email('v'),
        branchIds: [A.main],
        roles: [{ roleId: role.id }],
      };
      const make = (over: Record<string, unknown>) => post(A, 'sa', '/staff', { ...good, ...over });
      invalid(await post(A, 'sa', '/staff', []), 'body', 'REQUIRED');
      invalid(await make({ name: undefined }), 'name', 'REQUIRED');
      invalid(await make({ name: '   ' }), 'name', 'REQUIRED');
      invalid(await make({ name: 'x'.repeat(101) }), 'name', 'TOO_LONG');
      invalid(await make({ name: 'A\nB' }), 'name', 'INVALID');
      invalid(await make({ name: 5 }), 'name', 'INVALID');
      invalid(await make({ email: undefined }), 'email', 'REQUIRED');
      for (const bad of [
        'no-at-sign',
        'a@b',
        'a b@c.test',
        '<x>@c.test',
        'a@c.test, b@c.test',
        'a@@c.test',
      ]) {
        invalid(await make({ email: bad }), 'email', 'INVALID');
      }
      invalid(await make({ email: `${'a'.repeat(250)}@x.test` }), 'email', 'TOO_LONG');
      invalid(await make({ phone: 'call me' }), 'phone', 'INVALID');
      invalid(await make({ phone: '12' }), 'phone', 'INVALID');
      invalid(await make({ branchIds: undefined }), 'branchIds', 'REQUIRED');
      invalid(await make({ branchIds: [] }), 'branchIds', 'REQUIRED');
      invalid(await make({ branchIds: [A.main, A.main] }), 'branchIds', 'DUPLICATE');
      invalid(await make({ branchIds: ['no-such-branch'] }), 'branchIds.0', 'INVALID');
      invalid(await make({ branchIds: [B.main] }), 'branchIds.0', 'INVALID'); // another hospital
      invalid(await make({ roles: undefined }), 'roles', 'REQUIRED');
      invalid(await make({ roles: [] }), 'roles', 'REQUIRED');
      invalid(
        await make({ roles: [{ roleId: role.id }, { roleId: role.id }] }),
        'roles',
        'DUPLICATE',
      );
      invalid(await make({ roles: [{ roleId: 'no-such-role' }] }), 'roles.0.roleId', 'INVALID');
      invalid(await make({ roles: [{ roleId: B.superRoleId }] }), 'roles.0.roleId', 'INVALID'); // another hospital
      invalid(
        await make({ roles: [{ roleId: role.id, scope: 'EVERYWHERE' }] }),
        'roles.0.scope',
        'INVALID',
      );
      invalid(await make({ roles: [{}] }), 'roles.0.roleId', 'INVALID');
      invalid(
        await make({ roles: Array.from({ length: 6 }, (_, i) => ({ roleId: `r${i}` })) }),
        'roles',
        'TOO_MANY',
      );
      expect(await owner.user.count({ where: { tenantId: A.tenant } })).toBe(users);
      expect(activations).toEqual([]);
    });

    it('an email already used in the hospital is refused whatever its case; another hospital may use the same address', async () => {
      const first = await makeStaff(A, 'sa', { email: 'Shared.Address@Example.test' });
      expect(first.status).toBe(201);
      const again = await makeStaff(A, 'sa', { email: 'shared.address@EXAMPLE.test' });
      invalid(again, 'email', 'DUPLICATE');
      const other = await makeStaff(B, 'sa', { email: 'shared.address@example.test' });
      expect(other.status).toBe(201);
    });

    it('three requests for the same email at once: one person, the others are told it is used', async () => {
      const role = await makeRole(A, 'Race role', FLOOR_RECEPTION);
      const same = email('race');
      const results = await Promise.all(
        [1, 2, 3].map(() => makeStaff(A, 'sa', { email: same }, role.id)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 201)) {
        expect([400, 409]).toContain(r.status);
      }
      expect(await owner.user.count({ where: { tenantId: A.tenant, email: same } })).toBe(1);
    });

    it('staff codes made at the same moment are all different', async () => {
      const role = await makeRole(A, 'Code race role', FLOOR_RECEPTION);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => makeStaff(A, 'sa', {}, role.id)),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const codes = results.map((r) => r.body.staff.code);
      expect(new Set(codes).size).toBe(5);
    });

    it('a role that holds the doctor permission gives the person a doctor profile, once', async () => {
      const role = await makeRole(A, 'Doctor like', [
        'opd.queue.read',
        'opd.notes.write',
        'opd.doctors.own',
      ]);
      const made = await makeStaff(A, 'sa', {}, role.id);
      expect(made.status).toBe(201);
      expect(made.body.staff.doctorCode).toMatch(/^DR\d{3}$/);
      const profiles = await owner.doctorProfile.findMany({
        where: { tenantId: A.tenant, userId: made.body.staff.id },
      });
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.active).toBe(true);
      // changing the roles later and back does not make a second profile
      const plain = await makeRole(A, 'Plain again', ['opd.queue.read']);
      await put(A, 'sa', `/staff/${made.body.staff.id}`, {
        branchIds: [A.main],
        roles: [{ roleId: plain.id }],
      });
      await put(A, 'sa', `/staff/${made.body.staff.id}`, {
        branchIds: [A.main],
        roles: [{ roleId: role.id }],
      });
      expect(
        await owner.doctorProfile.count({
          where: { tenantId: A.tenant, userId: made.body.staff.id },
        }),
      ).toBe(1);
      // the next doctor gets the next code
      const second = await makeStaff(A, 'sa', {}, role.id);
      expect(second.body.staff.doctorCode).not.toBe(made.body.staff.doctorCode);
    });

    it('system roles: only a hospital-wide Admin gives them, and a SuperAdmin always gets hospital scope', async () => {
      const sup = await makeStaff(A, 'sa', {}, A.superRoleId);
      expect(sup.status).toBe(201);
      expect(sup.body.staff.roles[0]).toMatchObject({ code: 'SUPER_ADMIN', scope: 'HOSPITAL' });
      const bra = await makeStaff(A, 'sa', {}, A.branchAdminRoleId);
      expect(bra.status).toBe(201);
      expect(bra.body.staff.roles[0]).toMatchObject({
        code: 'BRANCH_ADMIN',
        scope: 'BRANCH',
        branchIds: [A.main],
      });
      invalid(await makeStaff(A, 'adminMain', {}, A.superRoleId), 'roles.0.roleId', 'NOT_ALLOWED');
      invalid(
        await makeStaff(A, 'adminMain', {}, A.branchAdminRoleId),
        'roles.0.roleId',
        'NOT_ALLOWED',
      );
      const hospitalBranchAdmin = await post(A, 'sa', '/staff', {
        name: 'X',
        email: email('hb'),
        branchIds: [A.main],
        roles: [{ roleId: A.branchAdminRoleId, scope: 'HOSPITAL' }],
      });
      invalid(hospitalBranchAdmin, 'roles.0.scope', 'INVALID');
    });

    it('a Branch Admin adds staff only to their own branch, with branch scope, and only floor or held permissions', async () => {
      const role = await makeRole(A, 'Reception for branch admin', FLOOR_RECEPTION);
      const ok = await makeStaff(A, 'adminMain', {}, role.id);
      expect(ok.status).toBe(201);
      expect(ok.body.staff.branches).toEqual([{ id: A.main, name: 'Main Branch' }]);
      invalid(
        await makeStaff(A, 'adminMain', { branchIds: [A.east] }, role.id),
        'branchIds.0',
        'NOT_ALLOWED',
      );
      invalid(
        await makeStaff(A, 'adminMain', { branchIds: [A.main, A.east] }, role.id),
        'branchIds.1',
        'NOT_ALLOWED',
      );
      invalid(
        await makeStaff(
          A,
          'adminMain',
          { roles: [{ roleId: role.id, scope: 'HOSPITAL' }] },
          role.id,
        ),
        'roles.0.roleId',
        'NOT_ALLOWED',
      );
      expect((await makeStaff(A, 'adminEast', { branchIds: [A.east] }, role.id)).status).toBe(201);
    });
  });

  describe('the staff list', () => {
    let list: Loose;
    beforeAll(async () => {
      const role = await makeRole(A, 'List role', FLOOR_RECEPTION);
      await makeStaff(A, 'sa', { name: 'Zed Findable', email: email('zed') }, role.id);
      await makeStaff(
        A,
        'sa',
        { name: 'East Only', email: email('east'), branchIds: [A.east] },
        role.id,
      );
      list = role;
    });

    it('a hospital-wide Admin sees everyone of the hospital, with who may be changed, and no other hospital', async () => {
      const res = await get(A, 'sa', '/staff?pageSize=100');
      expect(res.status).toBe(200);
      const names = res.body.items.map((i: Loose) => i.name);
      expect(names).toEqual(expect.arrayContaining(['Zed Findable', 'East Only']));
      expect(res.body.items.every((i: Loose) => i.editable)).toBe(true);
      const mine = res.body.items.find((i: Loose) => i.isYou);
      expect(mine.id).toBe(A.users.sa);
      const other = await get(B, 'sa', '/staff?pageSize=100');
      const ids = new Set(res.body.items.map((i: Loose) => i.id));
      for (const item of other.body.items) expect(ids.has(item.id)).toBe(false);
    });

    it('a Branch Admin sees people of their own branch, and cannot change a SuperAdmin or someone of another branch', async () => {
      const res = await get(A, 'adminMain', '/staff?pageSize=100');
      const names = res.body.items.map((i: Loose) => i.name);
      expect(names).toContain('Zed Findable');
      expect(names).not.toContain('East Only');
      const sa = res.body.items.find((i: Loose) => i.id === A.users.sa);
      expect(sa).toBeDefined(); // shares the branch
      expect(sa.editable).toBe(false);
      expect(res.body.items.find((i: Loose) => i.name === 'Zed Findable').editable).toBe(true);
    });

    it('searches by name, email and code, filters by status, and pages', async () => {
      expect(
        (await get(A, 'sa', '/staff?q=findable')).body.items.map((i: Loose) => i.name),
      ).toEqual(['Zed Findable']);
      const zed = (await get(A, 'sa', '/staff?q=Zed')).body.items[0];
      expect((await get(A, 'sa', `/staff?q=${encodeURIComponent(zed.email)}`)).body.total).toBe(1);
      expect(
        (await get(A, 'sa', `/staff?q=${zed.code}`)).body.items.some((i: Loose) => i.id === zed.id),
      ).toBe(true);
      expect(
        (await get(A, 'sa', '/staff?status=INVITED&pageSize=100')).body.items.every(
          (i: Loose) => i.status === 'INVITED',
        ),
      ).toBe(true);
      expect(
        (await get(A, 'sa', '/staff?status=ACTIVE&pageSize=100')).body.items.every(
          (i: Loose) => i.status === 'ACTIVE',
        ),
      ).toBe(true);
      const page1 = await get(A, 'sa', '/staff?pageSize=2&page=1');
      const page2 = await get(A, 'sa', '/staff?pageSize=2&page=2');
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBeGreaterThan(2);
      expect(page2.body.items.map((i: Loose) => i.id)).not.toEqual(
        page1.body.items.map((i: Loose) => i.id),
      );
    });

    it('junk in the query never breaks the list', async () => {
      for (const q of [
        'page=abc',
        'pageSize=-5',
        'pageSize=99999999',
        'page=0',
        'q=%27%3B%20drop%20table%20users%3B--',
        'status=NOPE',
        `q=${'x'.repeat(500)}`,
      ]) {
        const res = await get(A, 'sa', `/staff?${q}`);
        expect({ q, status: res.status }).toEqual({ q, status: 200 });
      }
      expect((await get(A, 'sa', '/staff?pageSize=99999999')).body.pageSize).toBe(25); // not a sane number
      expect((await get(A, 'sa', '/staff?pageSize=999999')).body.pageSize).toBe(100); // capped
    });

    it('the form options: branches and roles the caller may use, hospital scope only for a hospital-wide Admin, the code format', async () => {
      const sa = await get(A, 'sa', '/staff/options');
      expect(sa.body.branches.map((b: Loose) => b.id).sort()).toEqual([A.main, A.east].sort());
      expect(sa.body.canHospitalScope).toBe(true);
      expect(sa.body.codeFormat.next).toMatch(/\d+$/);
      expect(sa.body.roles.find((r: Loose) => r.id === list.id)).toMatchObject({
        assignable: true,
      });
      const admin = await get(A, 'adminMain', '/staff/options');
      expect(admin.body.branches).toEqual([{ id: A.main, name: 'Main Branch' }]);
      expect(admin.body.canHospitalScope).toBe(false);
      expect(admin.body.limits).toMatchObject({ nameMax: 100, maxRolesPerPerson: 5 });
    });
  });

  describe('changing a person', () => {
    it('an Admin corrects name, email and phone; an email used by someone else is refused; nothing else changes', async () => {
      const made = await makeStaff(A, 'sa', { name: 'Before Name' });
      const id = made.body.staff.id;
      const res = await put(A, 'sa', `/staff/${id}`, {
        name: 'After Name',
        email: 'After.Change@Example.test',
        phone: null,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'After Name',
        email: 'after.change@example.test',
        phone: null,
      });
      expect(res.body.roles).toHaveLength(1);
      const other = await makeStaff(A, 'sa');
      invalid(
        await put(A, 'sa', `/staff/${other.body.staff.id}`, { email: 'after.change@example.test' }),
        'email',
        'DUPLICATE',
      );
      // the same person may "change" to their own email
      expect(
        (await put(A, 'sa', `/staff/${id}`, { email: 'after.change@example.test' })).status,
      ).toBe(200);
      const trail = (await audits(A, 'STAFF_CHANGE')).filter((t) => t.entityId === id);
      expect(trail.map((t) => t.metadata)).toEqual([
        { changed: ['name', 'email', 'phone'], self: false },
        { changed: ['email'], self: false },
      ]);
    });

    it('branches and roles change together: old roles stay as history, removed branches end those sessions', async () => {
      const role = await makeRole(A, 'Two branch role', FLOOR_RECEPTION);
      const made = await makeStaff(A, 'sa', { branchIds: [A.main, A.east] }, role.id);
      const id = made.body.staff.id;
      for (const branchId of [A.main, A.east]) {
        await owner.authSession.create({
          data: {
            tenantId: A.tenant,
            userId: id,
            branchId,
            tokenHash: `t-${branchId}-${id}`,
            familyId: `f-${branchId}-${id}`,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
      }
      invalid(await put(A, 'sa', `/staff/${id}`, { branchIds: [A.main] }), 'roles', 'REQUIRED');
      invalid(
        await put(A, 'sa', `/staff/${id}`, { roles: [{ roleId: role.id }] }),
        'branchIds',
        'REQUIRED',
      );
      const other = await makeRole(A, 'Replacement role', ['opd.queue.read']);
      const res = await put(A, 'sa', `/staff/${id}`, {
        branchIds: [A.main],
        roles: [{ roleId: other.id }],
      });
      expect(res.status).toBe(200);
      expect(res.body.branches).toEqual([{ id: A.main, name: 'Main Branch' }]);
      expect(res.body.roles.map((r: Loose) => r.roleId)).toEqual([other.id]);
      const all = await owner.roleAssignment.findMany({ where: { userId: id } });
      expect(all).toHaveLength(2);
      expect(all.filter((a) => a.isActive)).toHaveLength(1); // the first one stays as history
      const sessions = await owner.authSession.findMany({ where: { userId: id } });
      expect(sessions.find((s) => s.branchId === A.east)!.revokedAt).not.toBeNull();
      expect(sessions.find((s) => s.branchId === A.main)!.revokedAt).toBeNull();
    });

    it('nobody changes their own roles or branches; their own name is fine', async () => {
      const mine = A.users.adminMain;
      conflict(
        await put(A, 'adminMain', `/staff/${mine}`, {
          branchIds: [A.main],
          roles: [{ roleId: A.branchAdminRoleId }],
        }),
        'SELF',
      );
      conflict(
        await put(A, 'sa', `/staff/${A.users.sa}`, {
          branchIds: [A.main],
          roles: [{ roleId: A.superRoleId }],
        }),
        'SELF',
      );
      // a Branch Admin may edit own name only through the allowed fields, but the person is "not manageable" by own scope? it is: same branch
      expect(
        (await put(A, 'sa', `/staff/${A.users.sa}`, { name: 'Renamed SuperAdmin' })).status,
      ).toBe(200);
    });

    it('the last SuperAdmin cannot lose the role or be switched off; with a second one it can', async () => {
      const lone = await seedHospital('LONE', false);
      // a hospital-wide user admin who is NOT a SuperAdmin (so the last-SuperAdmin guard is what decides)
      await (async () => {
        const u = await owner.user.create({
          data: {
            tenantId: lone.tenant,
            code: `ua${stamp}`,
            email: email('ua'),
            displayName: 'User admin',
            passwordHash: 'x',
            passwordChangedAt: new Date(),
          },
        });
        await owner.userBranch.create({
          data: { tenantId: lone.tenant, userId: u.id, branchId: lone.main },
        });
        const role = await owner.role.create({
          data: { tenantId: lone.tenant, code: `R_ua_${stamp}`, name: 'User admin role' },
        });
        const perms = await owner.permission.findMany({
          where: { code: { in: ['user.read', 'user.write'] } },
        });
        for (const p of perms) {
          await owner.rolePermission.create({
            data: { tenantId: lone.tenant, roleId: role.id, permissionId: p.id },
          });
        }
        await owner.roleAssignment.create({
          data: { tenantId: lone.tenant, userId: u.id, roleId: role.id, scopeType: 'HOSPITAL' },
        });
        lone.users.ua = u.id;
        lone.tokens.ua = tokenService.signHospitalAccess({
          tenantId: lone.tenant,
          userId: u.id,
          branchId: lone.main,
        });
      })();
      const plain = await makeRole(lone, 'Plain', ['opd.queue.read']);
      const plainBody = { branchIds: [lone.main], roles: [{ roleId: plain.id }] };
      // `sa` is the only SuperAdmin
      conflict(await put(lone, 'ua', `/staff/${lone.users.sa}`, plainBody), 'LAST_SUPER_ADMIN');
      conflict(await post(lone, 'ua', `/staff/${lone.users.sa}/deactivate`), 'LAST_SUPER_ADMIN');
      expect((await owner.user.findUniqueOrThrow({ where: { id: lone.users.sa } })).isActive).toBe(
        true,
      );
      // a second SuperAdmin: now the first may be demoted, and the second then is the last one
      const second = await makeStaff(lone, 'sa', {}, lone.superRoleId);
      expect(second.status).toBe(201);
      expect((await put(lone, 'ua', `/staff/${lone.users.sa}`, plainBody)).status).toBe(200);
      conflict(
        await put(lone, 'ua', `/staff/${second.body.staff.id}`, plainBody),
        'LAST_SUPER_ADMIN',
      );
      conflict(
        await post(lone, 'ua', `/staff/${second.body.staff.id}/deactivate`),
        'LAST_SUPER_ADMIN',
      );
    });

    it('a Branch Admin cannot reach a SuperAdmin, staff of another branch, or another hospital (404, untouched)', async () => {
      const east = await makeStaff(A, 'sa', { name: 'East Staff', branchIds: [A.east] });
      const eastId = east.body.staff.id;
      for (const target of [A.users.sa, eastId, B.users.sa]) {
        const res = await put(A, 'adminMain', `/staff/${target}`, { name: 'Hacked' });
        expect({ target, status: res.status }).toEqual({ target, status: 404 });
      }
      expect((await owner.user.findUniqueOrThrow({ where: { id: eastId } })).displayName).toBe(
        'East Staff',
      );
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: B.users.sa } })).displayName,
      ).not.toBe('Hacked');
      expect((await put(A, 'sa', '/staff/no-such-user', { name: 'x' })).status).toBe(404);
      invalid(await put(A, 'sa', `/staff/${eastId}`, {}), 'body', 'REQUIRED');
    });
  });

  describe('switching a person off and on', () => {
    it('off: they are inactive, every session ends at once, the history stays; on again works', async () => {
      const made = await makeStaff(A, 'sa');
      const id = made.body.staff.id;
      await owner.user.update({ where: { id }, data: { passwordChangedAt: new Date() } });
      await owner.authSession.create({
        data: {
          tenantId: A.tenant,
          userId: id,
          branchId: A.main,
          tokenHash: `off-${id}`,
          familyId: `off-f-${id}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const off = await post(A, 'sa', `/staff/${id}/deactivate`);
      expect(off.status).toBe(200);
      expect(off.body.status).toBe('INACTIVE');
      expect(
        (await owner.authSession.findFirstOrThrow({ where: { userId: id } })).revokedAt,
      ).not.toBeNull();
      expect(await owner.user.count({ where: { id } })).toBe(1);
      expect(await owner.roleAssignment.count({ where: { userId: id, isActive: true } })).toBe(1);
      const on = await post(A, 'sa', `/staff/${id}/reactivate`);
      expect(on.body.status).toBe('ACTIVE');
      expect((await audits(A, 'STAFF_DEACTIVATE')).some((t) => t.entityId === id)).toBe(true);
      expect((await audits(A, 'STAFF_REACTIVATE')).some((t) => t.entityId === id)).toBe(true);
    });

    it('nobody switches themselves off; the last SuperAdmin stays; the others are out of reach', async () => {
      conflict(await post(A, 'sa', `/staff/${A.users.sa}/deactivate`), 'SELF');
      conflict(await post(A, 'adminMain', `/staff/${A.users.adminMain}/deactivate`), 'SELF');
      // a Branch Admin cannot reach the SuperAdmin or another hospital
      expect((await post(A, 'adminMain', `/staff/${A.users.sa}/deactivate`)).status).toBe(404);
      expect((await post(A, 'sa', `/staff/${B.users.sa}/deactivate`)).status).toBe(404);
      expect((await owner.user.findUniqueOrThrow({ where: { id: B.users.sa } })).isActive).toBe(
        true,
      );
    });

    it('resend invite: only before a password is set, one a minute, never for an inactive person', async () => {
      const made = await makeStaff(A, 'sa');
      const id = made.body.staff.id;
      activations.length = 0;
      const first = await post(A, 'sa', `/staff/${id}/resend-invite`);
      expect(first.status).toBe(200);
      expect(activations).toEqual([{ kind: 'ACTIVATION', tenantId: A.tenant, userId: id }]);
      const second = await post(A, 'sa', `/staff/${id}/resend-invite`);
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('RATE_LIMITED');
      expect(second.body.retryAfterSec).toBeGreaterThan(0);
      expect(activations).toHaveLength(1);
      await owner.user.update({ where: { id }, data: { passwordChangedAt: new Date() } });
      await redis.clearPrefixKeys();
      conflict(await post(A, 'sa', `/staff/${id}/resend-invite`), 'ALREADY_ACTIVE');
      await post(A, 'sa', `/staff/${id}/deactivate`);
      conflict(await post(A, 'sa', `/staff/${id}/resend-invite`), 'INACTIVE');
      expect((await post(A, 'sa', '/staff/no-such-user/resend-invite')).status).toBe(404);
      expect((await post(A, 'adminMain', `/staff/${A.users.sa}/resend-invite`)).status).toBe(404);
    });
  });
});
