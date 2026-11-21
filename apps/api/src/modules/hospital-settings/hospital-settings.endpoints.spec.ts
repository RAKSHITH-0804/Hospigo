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

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the settings tests`);
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

/** JSON bodies of the HTTP responses are checked field by field in these tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

type Hospital = {
  tenant: string;
  main: string;
  tokens: Record<string, string>;
  users: Record<string, string>;
};

const ADMIN_CODES = [
  'hospital.settings.read',
  'hospital.settings.write',
  'opd.settings.write',
  'patients.registry.read',
] as const;
const READER_CODES = ['hospital.settings.read'] as const;
const WRITER_CODES = ['hospital.settings.write'] as const;
const RULER_CODES = ['opd.settings.write'] as const;
const RECEPTION_CODES = ['opd.visits.read', 'opd.billing.read'] as const;
const ALL_CODES = [
  ...new Set([
    ...ADMIN_CODES,
    ...READER_CODES,
    ...WRITER_CODES,
    ...RULER_CODES,
    ...RECEPTION_CODES,
  ]),
];

describe('hospital settings (HTTP)', () => {
  jest.setTimeout(180_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let A: Hospital;
  let B: Hospital;

  async function seedHospital(label: string): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `HS_${label}_${stamp}`,
        name: `Settings ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `hs-${label}-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const main = hospital.branches[0]!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    await owner.branchModule.create({
      data: { tenantId: tenant, branchId: main, moduleId: opd.id, enabledByIndigo: true },
    });
    const perms = await owner.permission.findMany({ where: { code: { in: ALL_CODES } } });
    if (perms.length !== ALL_CODES.length) {
      throw new Error('Permissions missing from the test catalog');
    }
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    async function makeUser(key: string, codes: readonly string[]) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `hs_${key}_${label}_${stamp}@example.test`,
          displayName: `Person ${key}`,
          passwordHash: 'x',
        },
      });
      await owner.userBranch.create({ data: { tenantId: tenant, userId: u.id, branchId: main } });
      if (codes.length > 0) {
        const role = await owner.role.create({
          data: { tenantId: tenant, code: `R_${key}_${stamp}`, name: key },
        });
        for (const code of codes) {
          await owner.rolePermission.create({
            data: { tenantId: tenant, roleId: role.id, permissionId: permId[code]! },
          });
        }
        const assignment = await owner.roleAssignment.create({
          data: { tenantId: tenant, userId: u.id, roleId: role.id, scopeType: 'BRANCH' },
        });
        await owner.roleAssignmentBranch.create({
          data: { tenantId: tenant, assignmentId: assignment.id, branchId: main },
        });
      }
      users[key] = u.id;
      tokens[key] = tokenService.signHospitalAccess({
        tenantId: tenant,
        userId: u.id,
        branchId: main,
      });
    }
    await makeUser('admin', ADMIN_CODES);
    await makeUser('reader', READER_CODES);
    await makeUser('writer', WRITER_CODES);
    await makeUser('ruler', RULER_CODES);
    await makeUser('reception', RECEPTION_CODES);
    await makeUser('nobody', []);
    return { tenant, main, tokens, users };
  }

  beforeAll(async () => {
    const { AppModule } = await import('../../app.module');
    const { TokenService } = await import('../auth/token.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    tokenService = app.get(TokenService);
    A = await seedHospital('A');
    B = await seedHospital('B');
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const as = (h: Hospital, who: string) => ({ Authorization: `Bearer ${h.tokens[who]}` });
  const call = (
    method: 'get' | 'put' | 'post' | 'patch',
    h: Hospital,
    who: string,
    url: string,
    body?: unknown,
  ) =>
    (http() as Loose)
      [method](url)
      .set(as(h, who))
      .send(body ?? {});
  const get = (h: Hospital, who: string, url: string) => call('get', h, who, url);
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

  const ROUTES: Array<['get' | 'put' | 'post' | 'patch', string]> = [
    ['get', '/settings/opd-rules'],
    ['put', '/settings/opd-rules'],
    ['get', '/settings/patient-fields'],
    ['put', '/settings/patient-fields/builtin/gender'],
    ['post', '/settings/patient-fields/custom'],
    ['patch', '/settings/patient-fields/custom/x'],
    ['put', '/settings/patient-fields/custom/x/options'],
    ['get', '/settings/uhid-format'],
    ['post', '/settings/uhid-format'],
  ];
  const WRITES = ROUTES.filter(([m]) => m !== 'get');

  describe('access', () => {
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

    it('reading needs hospital.settings.read: reception and nobody get 403 on every read', async () => {
      for (const who of ['reception', 'nobody', 'writer']) {
        for (const [method, url] of ROUTES.filter(([m]) => m === 'get')) {
          expect({ who, url, status: (await call(method, A, who, url)).status }).toEqual({
            who,
            url,
            status: 403,
          });
        }
      }
      for (const url of [
        '/settings/opd-rules',
        '/settings/patient-fields',
        '/settings/uhid-format',
      ]) {
        expect((await get(A, 'reader', url)).status).toBe(200);
      }
    });

    it('a reader, reception and nobody get 403 on every write, and nothing is stored', async () => {
      for (const who of ['reader', 'reception', 'nobody']) {
        for (const [method, url] of WRITES) {
          expect({ who, url, status: (await call(method, A, who, url, {})).status }).toEqual({
            who,
            url,
            status: 403,
          });
        }
      }
      expect(await owner.opdSettings.count({ where: { tenantId: A.tenant } })).toBe(0);
      expect(await owner.patientCustomField.count({ where: { tenantId: A.tenant } })).toBe(0);
      expect(await owner.uhidFormatConfig.count({ where: { tenantId: A.tenant } })).toBe(0);
    });

    it('the OPD rules need opd.settings.write, the others hospital.settings.write', async () => {
      expect(
        (await call('put', A, 'writer', '/settings/opd-rules', { followUpFreeDays: 3 })).status,
      ).toBe(403);
      expect(
        (await call('put', A, 'ruler', '/settings/opd-rules', { followUpFreeDays: 3 })).status,
      ).toBe(200);
      expect(
        (
          await call('put', A, 'ruler', '/settings/patient-fields/builtin/gender', {
            isRequired: true,
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('OPD rules', () => {
    it('shows the documented defaults before anything is saved, with the limits', async () => {
      const res = await get(B, 'admin', '/settings/opd-rules');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        followUpFreeDays: 7,
        repeatVisitFreeHours: 0,
        persisted: false,
        limits: {
          followUpFreeDays: { min: 0, max: 365 },
          repeatVisitFreeHours: { min: 0, max: 8760 },
        },
      });
    });

    it('saves one or both rules, keeps the other, audits the names only, and touches no other hospital', async () => {
      const first = await call('put', A, 'admin', '/settings/opd-rules', { followUpFreeDays: 10 });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        followUpFreeDays: 10,
        repeatVisitFreeHours: 0,
        persisted: true,
      });
      const second = await call('put', A, 'admin', '/settings/opd-rules', {
        repeatVisitFreeHours: 24,
        followUpFreeDays: 0,
      });
      expect(second.body).toMatchObject({ followUpFreeDays: 0, repeatVisitFreeHours: 24 });
      const row = await owner.opdSettings.findUnique({ where: { tenantId: A.tenant } });
      expect(row).toMatchObject({
        followUpFreeDays: 0,
        repeatVisitFreeHours: 24,
        tokenPrefix: 'T',
      });
      expect(await owner.opdSettings.count({ where: { tenantId: B.tenant } })).toBe(0);
      const trail = (await audits(A, 'OPD_RULES_CHANGE')).filter(
        (t) => t.actorUserId === A.users.admin,
      );
      expect(trail).toHaveLength(2);
      expect(trail[0]!.metadata).toEqual({ changed: ['followUpFreeDays'] });
      expect(trail[1]!.metadata).toEqual({ changed: ['followUpFreeDays', 'repeatVisitFreeHours'] });
      expect(trail[1]!.actorUserId).toBe(A.users.admin);
    });

    it('refuses numbers outside the range, fractions, text, and an empty body (nothing changes)', async () => {
      const before = await owner.opdSettings.findUnique({ where: { tenantId: A.tenant } });
      for (const bad of [-1, 366, 1.5, '7', null, true, Number.NaN]) {
        const res = await call('put', A, 'admin', '/settings/opd-rules', { followUpFreeDays: bad });
        invalid(res, 'followUpFreeDays', 'OUT_OF_RANGE');
      }
      invalid(
        await call('put', A, 'admin', '/settings/opd-rules', { repeatVisitFreeHours: 8761 }),
        'repeatVisitFreeHours',
        'OUT_OF_RANGE',
      );
      invalid(await call('put', A, 'admin', '/settings/opd-rules', {}), 'body', 'REQUIRED');
      invalid(
        await call('put', A, 'admin', '/settings/opd-rules', {
          tokenPrefix: 'ZZ',
          timezone: 'UTC',
        }),
        'body',
        'REQUIRED',
      );
      const after = await owner.opdSettings.findUnique({ where: { tenantId: A.tenant } });
      expect(after).toEqual(before);
    });

    it('does not let the body choose the hospital', async () => {
      const res = await call('put', B, 'admin', '/settings/opd-rules', {
        followUpFreeDays: 5,
        tenantId: A.tenant,
      });
      expect(res.status).toBe(200);
      expect(
        (await owner.opdSettings.findUnique({ where: { tenantId: A.tenant } }))!.followUpFreeDays,
      ).toBe(0);
      expect(
        (await owner.opdSettings.findUnique({ where: { tenantId: B.tenant } }))!.followUpFreeDays,
      ).toBe(5);
    });
  });

  describe('registration fields: built-in', () => {
    it('lists every built-in field with its switches; name is locked on and required', async () => {
      const res = await get(A, 'admin', '/settings/patient-fields');
      expect(res.status).toBe(200);
      const name = res.body.builtin.find((f: Loose) => f.key === 'name');
      expect(name).toMatchObject({ isEnabled: true, isRequired: true, alwaysRequired: true });
      expect(res.body.builtin.length).toBeGreaterThanOrEqual(11);
      expect(res.body.custom).toEqual([]);
      expect(res.body.limits.maxCustomFields).toBe(30);
    });

    it('makes a field required or optional, and switching it off makes it optional', async () => {
      const on = await call('put', A, 'admin', '/settings/patient-fields/builtin/gender', {
        isRequired: true,
      });
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ key: 'gender', isRequired: true, isEnabled: true });
      const off = await call('put', A, 'admin', '/settings/patient-fields/builtin/email', {
        isEnabled: false,
      });
      expect(off.body).toMatchObject({ key: 'email', isEnabled: false, isRequired: false });
      const list = await get(A, 'admin', '/settings/patient-fields');
      expect(list.body.builtin.find((f: Loose) => f.key === 'gender').isRequired).toBe(true);
      // the registration form of the same hospital follows
      const form = await get(A, 'admin', '/patients/form-config');
      const keys = form.body.fields.map((f: Loose) => f.key).filter(Boolean);
      expect(keys).not.toContain('email');
      expect(form.body.fields.find((f: Loose) => f.key === 'gender').required).toBe(true);
      // the other hospital is untouched
      const other = await get(B, 'admin', '/settings/patient-fields');
      expect(other.body.builtin.find((f: Loose) => f.key === 'gender').isRequired).toBe(false);
      expect(other.body.builtin.find((f: Loose) => f.key === 'email').isEnabled).toBe(true);
      const trail = await audits(A, 'PATIENT_FIELD_SETTING_CHANGE');
      expect(trail.map((t) => t.metadata)).toEqual([
        { changed: ['isRequired'] },
        { changed: ['isEnabled'] },
      ]);
    });

    it('refuses to switch off or relax a locked field, an unknown key, and bad input', async () => {
      invalid(
        await call('put', A, 'admin', '/settings/patient-fields/builtin/name', {
          isRequired: false,
        }),
        'isRequired',
        'LOCKED',
      );
      invalid(
        await call('put', A, 'admin', '/settings/patient-fields/builtin/name', {
          isEnabled: false,
        }),
        'isEnabled',
        'LOCKED',
      );
      invalid(
        await call('put', A, 'admin', '/settings/patient-fields/builtin/phone', {
          isEnabled: false,
        }),
        'isEnabled',
        'LOCKED',
      );
      expect(
        (
          await call('put', A, 'admin', '/settings/patient-fields/builtin/nope', {
            isRequired: true,
          })
        ).status,
      ).toBe(404);
      invalid(
        await call('put', A, 'admin', '/settings/patient-fields/builtin/gender', {
          isRequired: 'yes',
        }),
        'isRequired',
        'INVALID',
      );
      invalid(
        await call('put', A, 'admin', '/settings/patient-fields/builtin/gender', {}),
        'body',
        'REQUIRED',
      );
    });
  });

  describe('registration fields: custom', () => {
    let blood: Loose;
    let diet: Loose;

    it('adds a text field and a dropdown; the registration form then asks for them', async () => {
      const text = await call('post', A, 'admin', '/settings/patient-fields/custom', {
        label: '  Blood   group ',
        dataType: 'TEXT',
        section: 'PERSONAL',
        isRequired: true,
      });
      expect(text.status).toBe(201);
      blood = text.body;
      expect(blood).toMatchObject({
        code: 'cf_blood_group',
        label: 'Blood group',
        dataType: 'TEXT',
        section: 'PERSONAL',
        isEnabled: true,
        isRequired: true,
        options: [],
      });
      const drop = await call('post', A, 'admin', '/settings/patient-fields/custom', {
        label: 'Diet',
        dataType: 'DROPDOWN',
        options: ['Vegetarian', { label: 'Non vegetarian' }],
      });
      expect(drop.status).toBe(201);
      diet = drop.body;
      expect(diet.section).toBe('OTHER');
      expect(diet.options.map((o: Loose) => [o.label, o.sortOrder, o.isActive])).toEqual([
        ['Vegetarian', 0, true],
        ['Non vegetarian', 1, true],
      ]);
      const form = await get(A, 'admin', '/patients/form-config');
      const custom = form.body.fields.filter((f: Loose) => f.code);
      expect(custom.map((f: Loose) => f.code).sort()).toEqual(['cf_blood_group', 'cf_diet']);
      expect(custom.find((f: Loose) => f.code === 'cf_blood_group').required).toBe(true);
      expect(custom.find((f: Loose) => f.code === 'cf_diet').options).toHaveLength(2);
      // another hospital does not see them
      const other = await get(B, 'admin', '/patients/form-config');
      expect(other.body.fields.filter((f: Loose) => f.code)).toEqual([]);
    });

    it('gives a field with a similar label its own code, and refuses the same label twice', async () => {
      const similar = await call('post', A, 'admin', '/settings/patient-fields/custom', {
        label: 'Blood-group!',
        dataType: 'TEXT',
      });
      expect(similar.status).toBe(201);
      expect(similar.body.code).toBe('cf_blood_group_2');
      invalid(
        await call('post', A, 'admin', '/settings/patient-fields/custom', {
          label: 'BLOOD GROUP',
          dataType: 'TEXT',
        }),
        'label',
        'DUPLICATE',
      );
    });

    it('refuses bad new fields with the field and the reason', async () => {
      const post = (body: unknown) =>
        call('post', A, 'admin', '/settings/patient-fields/custom', body);
      invalid(await post({ dataType: 'TEXT' }), 'label', 'REQUIRED');
      invalid(await post({ label: '   ', dataType: 'TEXT' }), 'label', 'REQUIRED');
      invalid(await post({ label: 'x'.repeat(61), dataType: 'TEXT' }), 'label', 'TOO_LONG');
      invalid(await post({ label: 'A', dataType: 'IMAGE' }), 'dataType', 'INVALID');
      invalid(await post({ label: 'A' }), 'dataType', 'REQUIRED');
      invalid(
        await post({ label: 'A', dataType: 'TEXT', section: 'HEADER' }),
        'section',
        'INVALID',
      );
      invalid(
        await post({ label: 'A', dataType: 'TEXT', isRequired: 'yes' }),
        'isRequired',
        'INVALID',
      );
      invalid(await post({ label: 'A', dataType: 'TEXT', options: ['x'] }), 'options', 'INVALID');
      invalid(await post({ label: 'A', dataType: 'DROPDOWN' }), 'options', 'NEEDS_AN_OPTION');
      invalid(
        await post({ label: 'A', dataType: 'DROPDOWN', options: [] }),
        'options',
        'NEEDS_AN_OPTION',
      );
      invalid(
        await post({ label: 'A', dataType: 'DROPDOWN', options: ['x', 'X'] }),
        'options',
        'DUPLICATE',
      );
      invalid(
        await post({
          label: 'A',
          dataType: 'DROPDOWN',
          options: Array.from({ length: 51 }, (_, i) => `o${i}`),
        }),
        'options',
        'TOO_MANY',
      );
      invalid(
        await post({ label: 'A', dataType: 'DROPDOWN', options: ['x'.repeat(61)] }),
        'options.0.label',
        'TOO_LONG',
      );
      invalid(await post([]), 'body', 'REQUIRED');
    });

    it('renames, moves, makes optional, and switches off a field (a field that is off is never required)', async () => {
      const renamed = await call(
        'patch',
        A,
        'admin',
        `/settings/patient-fields/custom/${blood.id}`,
        {
          label: 'Blood type',
          section: 'CONTACT',
          isRequired: false,
        },
      );
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({
        label: 'Blood type',
        section: 'CONTACT',
        isRequired: false,
        code: 'cf_blood_group',
      });
      await call('patch', A, 'admin', `/settings/patient-fields/custom/${blood.id}`, {
        isRequired: true,
      });
      const off = await call('patch', A, 'admin', `/settings/patient-fields/custom/${blood.id}`, {
        isEnabled: false,
      });
      expect(off.body).toMatchObject({ isEnabled: false, isRequired: false });
      const form = await get(A, 'admin', '/patients/form-config');
      expect(form.body.fields.map((f: Loose) => f.code)).not.toContain('cf_blood_group');
      // switching it off never deletes it
      expect(await owner.patientCustomField.count({ where: { id: blood.id } })).toBe(1);
      const back = await call('patch', A, 'admin', `/settings/patient-fields/custom/${blood.id}`, {
        isEnabled: true,
      });
      expect(back.body.isEnabled).toBe(true);
    });

    it('refuses a rename to a label already used, a bad body, and cannot change the type or code', async () => {
      const url = `/settings/patient-fields/custom/${blood.id}`;
      invalid(await call('patch', A, 'admin', url, { label: 'diet' }), 'label', 'DUPLICATE');
      invalid(await call('patch', A, 'admin', url, {}), 'body', 'REQUIRED');
      invalid(await call('patch', A, 'admin', url, { section: 'X' }), 'section', 'INVALID');
      invalid(await call('patch', A, 'admin', url, { isEnabled: 1 }), 'isEnabled', 'INVALID');
      // dataType and code are not on the list: ignored, and with nothing else it is an empty body
      invalid(
        await call('patch', A, 'admin', url, { dataType: 'DATE', code: 'zzz' }),
        'body',
        'REQUIRED',
      );
      const row = await owner.patientCustomField.findUnique({ where: { id: blood.id } });
      expect(row).toMatchObject({ dataType: 'TEXT', code: 'cf_blood_group' });
    });

    it('replaces the choices of a dropdown: renames, adds, switches off (never deletes), keeps the order', async () => {
      const [veg, nonVeg] = diet.options;
      const url = `/settings/patient-fields/custom/${diet.id}/options`;
      const res = await call('put', A, 'admin', url, {
        options: [{ label: 'Jain' }, { id: veg.id, label: 'Vegetarian (pure)' }],
      });
      expect(res.status).toBe(200);
      const byLabel = Object.fromEntries(res.body.options.map((o: Loose) => [o.label, o]));
      expect(byLabel['Jain']).toMatchObject({ sortOrder: 0, isActive: true });
      expect(byLabel['Vegetarian (pure)']).toMatchObject({
        id: veg.id,
        sortOrder: 1,
        isActive: true,
      });
      expect(byLabel['Non vegetarian']).toMatchObject({ id: nonVeg.id, isActive: false });
      expect(await owner.patientCustomFieldOption.count({ where: { fieldId: diet.id } })).toBe(3);
      const form = await get(A, 'admin', '/patients/form-config');
      const shown = form.body.fields
        .find((f: Loose) => f.code === 'cf_diet')
        .options.map((o: Loose) => o.label);
      expect(shown).toEqual(['Jain', 'Vegetarian (pure)']);
      // a switched-off choice can come back
      const back = await call('put', A, 'admin', url, {
        options: [
          { id: nonVeg.id, label: 'Non vegetarian', isActive: true },
          { id: veg.id, label: 'Vegetarian' },
        ],
      });
      expect(back.body.options.filter((o: Loose) => o.isActive).map((o: Loose) => o.label)).toEqual(
        ['Non vegetarian', 'Vegetarian'],
      );
    });

    it('refuses bad choice lists, a text field, and choices of another field', async () => {
      const url = `/settings/patient-fields/custom/${diet.id}/options`;
      const put = (body: unknown) => call('put', A, 'admin', url, body);
      invalid(await put({}), 'options', 'REQUIRED');
      invalid(await put({ options: [] }), 'options', 'NEEDS_AN_OPTION');
      invalid(
        await put({ options: [{ label: 'a', isActive: false }] }),
        'options',
        'NEEDS_AN_OPTION',
      );
      invalid(await put({ options: [{ label: 'a' }, { label: 'A' }] }), 'options', 'DUPLICATE');
      invalid(await put({ options: [{ label: '' }] }), 'options.0.label', 'REQUIRED');
      invalid(await put({ options: ['a'] }), 'options.0', 'INVALID');
      invalid(
        await put({
          options: [
            { id: diet.options[0].id, label: 'a' },
            { id: diet.options[0].id, label: 'b' },
          ],
        }),
        'options',
        'DUPLICATE',
      );
      invalid(await put({ options: [{ id: 'not-mine', label: 'a' }] }), 'options.0.id', 'INVALID');
      invalid(
        await call('put', A, 'admin', `/settings/patient-fields/custom/${blood.id}/options`, {
          options: [{ label: 'a' }],
        }),
        'options',
        'NOT_A_DROPDOWN',
      );
    });

    it('does not reach another hospital: its field ids and options are 404 or refused', async () => {
      const foreign = await call('post', B, 'admin', '/settings/patient-fields/custom', {
        label: 'Insurance',
        dataType: 'DROPDOWN',
        options: ['Yes', 'No'],
      });
      expect(foreign.status).toBe(201);
      const f = foreign.body;
      expect(
        (
          await call('patch', A, 'admin', `/settings/patient-fields/custom/${f.id}`, {
            label: 'Hacked',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call('put', A, 'admin', `/settings/patient-fields/custom/${f.id}/options`, {
            options: [{ label: 'x' }],
          })
        ).status,
      ).toBe(404);
      // a choice of B's field offered inside A's own field is refused
      invalid(
        await call('put', A, 'admin', `/settings/patient-fields/custom/${diet.id}/options`, {
          options: [{ id: f.options[0].id, label: 'x' }],
        }),
        'options.0.id',
        'INVALID',
      );
      const intact = await owner.patientCustomField.findUnique({ where: { id: f.id } });
      expect(intact!.label).toBe('Insurance');
      expect(
        (await owner.patientCustomFieldOption.findMany({ where: { fieldId: f.id } }))
          .map((o) => o.label)
          .sort(),
      ).toEqual(['No', 'Yes']);
    });

    it('two administrators adding the same field at once: one wins, the other is told the name is used (never a server error)', async () => {
      const add = () =>
        call('post', A, 'admin', '/settings/patient-fields/custom', {
          label: 'Race condition field',
          dataType: 'TEXT',
        });
      const results = await Promise.all([add(), add(), add()]);
      const codes = results.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.every((c) => c === 201 || c === 400)).toBe(true);
      for (const r of results.filter((x) => x.status === 400)) {
        invalid(r, 'label', 'DUPLICATE');
      }
      expect(
        await owner.patientCustomField.count({
          where: { tenantId: A.tenant, label: 'Race condition field' },
        }),
      ).toBe(1);
    });

    it('a name with no letters or digits still gets a safe code', async () => {
      const res = await call('post', A, 'admin', '/settings/patient-fields/custom', {
        label: '日本語 <b>&</b>',
        dataType: 'TEXT',
      });
      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^cf_[a-z0-9_]+$/);
      expect(res.body.label).toBe('日本語 <b>&</b>');
    });

    it('audits the names of what changed, never the labels or choices', async () => {
      const trail = await audits(A, 'PATIENT_FIELD_SETTING_CHANGE');
      const custom = trail.filter((t) => t.entityType === 'patient_custom_fields');
      expect(custom.length).toBeGreaterThanOrEqual(6);
      for (const t of custom) {
        expect(Object.keys(t.metadata as object)).toEqual(['changed']);
        const text = JSON.stringify(t.metadata);
        expect(text).not.toMatch(/Blood|Diet|Jain|Vegetarian/);
      }
    });

    it('stops at the limit of custom fields', async () => {
      const have = await owner.patientCustomField.count({ where: { tenantId: A.tenant } });
      for (let i = have; i < 30; i++) {
        const ok = await call('post', A, 'admin', '/settings/patient-fields/custom', {
          label: `Extra ${i}`,
          dataType: 'TEXT',
        });
        expect(ok.status).toBe(201);
      }
      invalid(
        await call('post', A, 'admin', '/settings/patient-fields/custom', {
          label: 'One too many',
          dataType: 'TEXT',
        }),
        'label',
        'TOO_MANY',
      );
    });
  });

  describe('patient number (UHID) format', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      resetRule: 'NEVER',
      blocks: [
        { blockType: 'FIXED_TEXT', textValue: 'UH' },
        { blockType: 'SEPARATOR', textValue: '-' },
        { blockType: 'RUNNING_NUMBER', minWidth: 5 },
      ],
      ...over,
    });

    it('says nothing is configured before the first save', async () => {
      const res = await get(B, 'admin', '/settings/uhid-format');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        configured: false,
        format: null,
        effectiveFrom: null,
        example: null,
        next: null,
        branchCode: 'MAIN',
        limits: { maxBlocks: 12, maxTextLength: 10, minWidthMin: 1, minWidthMax: 12 },
      });
    });

    it('saves a format, shows the sample and the next number, and audits names only', async () => {
      const res = await call('post', A, 'admin', '/settings/uhid-format', body());
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.example).toBe('UH-00001');
      expect(res.body.next).toBe('UH-00001');
      expect(res.body.format).toEqual({
        resetRule: 'NEVER',
        fyStartMonth: 4,
        blocks: [
          { blockType: 'FIXED_TEXT', textValue: 'UH', fyStyle: null, minWidth: null },
          { blockType: 'SEPARATOR', textValue: '-', fyStyle: null, minWidth: null },
          { blockType: 'RUNNING_NUMBER', textValue: null, fyStyle: null, minWidth: 5 },
        ],
      });
      const again = await get(A, 'reader', '/settings/uhid-format');
      expect(again.body.example).toBe('UH-00001');
      const trail = await audits(A, 'UHID_FORMAT_CHANGE');
      expect(trail).toHaveLength(1);
      expect(trail[0]!.metadata).toEqual({
        resetRule: 'NEVER',
        blockTypes: ['FIXED_TEXT', 'SEPARATOR', 'RUNNING_NUMBER'],
        counterCarriedForward: false,
      });
      expect(await owner.uhidFormatConfig.count({ where: { tenantId: B.tenant } })).toBe(0);
    });

    it('uses the branch code and keeps old formats as history', async () => {
      const res = await call('post', A, 'admin', '/settings/uhid-format', {
        resetRule: 'NEVER',
        blocks: [
          { blockType: 'BRANCH_CODE' },
          { blockType: 'SEPARATOR', textValue: '/' },
          { blockType: 'CALENDAR_YEAR' },
          { blockType: 'SEPARATOR', textValue: '/' },
          { blockType: 'RUNNING_NUMBER', minWidth: 4 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.example).toMatch(/^MAIN\/\d{4}\/0001$/);
      expect(await owner.uhidFormatConfig.count({ where: { tenantId: A.tenant } })).toBe(2);
    });

    it('never lets the running number go back or repeat when the counting period changes', async () => {
      // "never restart" counter at 40; the new format restarts each financial year
      await owner.uhidCounter.deleteMany({ where: { tenantId: A.tenant } });
      await owner.uhidCounter.create({
        data: { tenantId: A.tenant, periodYear: 0, lastNumber: 40n },
      });
      const res = await call('post', A, 'admin', '/settings/uhid-format', {
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: 4,
        blocks: [
          { blockType: 'FINANCIAL_YEAR', fyStyle: 'LONG' },
          { blockType: 'SEPARATOR', textValue: '/' },
          { blockType: 'RUNNING_NUMBER', minWidth: 5 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.next).toMatch(/^\d{4}-\d{2}\/00041$/);
      const counters = await owner.uhidCounter.findMany({ where: { tenantId: A.tenant } });
      expect(counters.filter((c) => c.periodYear !== 0).map((c) => c.lastNumber)).toEqual([40n]);
      const trail = await audits(A, 'UHID_FORMAT_CHANGE');
      expect(trail.at(-1)!.metadata).toMatchObject({ counterCarriedForward: true });
      // a counter that is already higher is never lowered
      await owner.uhidCounter.updateMany({
        where: { tenantId: A.tenant, periodYear: { not: 0 } },
        data: { lastNumber: 90n },
      });
      await call('post', A, 'admin', '/settings/uhid-format', {
        resetRule: 'NEVER',
        blocks: [{ blockType: 'RUNNING_NUMBER', minWidth: 3 }],
      });
      await call('post', A, 'admin', '/settings/uhid-format', {
        resetRule: 'FINANCIAL_YEAR',
        blocks: [{ blockType: 'FINANCIAL_YEAR' }, { blockType: 'RUNNING_NUMBER' }],
      });
      const after = await owner.uhidCounter.findMany({ where: { tenantId: A.tenant } });
      expect(Math.max(...after.map((c) => Number(c.lastNumber)))).toBeGreaterThanOrEqual(90);
      expect(after.find((c) => c.periodYear !== 0)!.lastNumber >= 90n).toBe(true);
    });

    it('refuses every wrong format with the field and the reason, and stores nothing', async () => {
      const before = await owner.uhidFormatConfig.count({ where: { tenantId: A.tenant } });
      const post = (b: unknown) => call('post', A, 'admin', '/settings/uhid-format', b);
      const run = { blockType: 'RUNNING_NUMBER', minWidth: 4 };
      invalid(await post([]), 'body', 'REQUIRED');
      invalid(await post(body({ resetRule: undefined })), 'resetRule', 'REQUIRED');
      invalid(await post(body({ resetRule: 'MONTHLY' })), 'resetRule', 'INVALID');
      invalid(await post(body({ fyStartMonth: 13 })), 'fyStartMonth', 'INVALID');
      invalid(await post(body({ fyStartMonth: 'April' })), 'fyStartMonth', 'INVALID');
      invalid(await post(body({ blocks: undefined })), 'blocks', 'REQUIRED');
      invalid(await post(body({ blocks: [] })), 'blocks', 'REQUIRED');
      invalid(
        await post(
          body({
            blocks: Array.from({ length: 13 }, () => ({ blockType: 'SEPARATOR', textValue: '-' })),
          }),
        ),
        'blocks',
        'TOO_MANY',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'FIXED_TEXT', textValue: 'UH' }] })),
        'blocks',
        'NEEDS_RUNNING_NUMBER',
      );
      invalid(
        await post(body({ blocks: [run, { blockType: 'RUNNING_NUMBER' }] })),
        'blocks.1.blockType',
        'DUPLICATE',
      );
      invalid(
        await post(
          body({ blocks: [{ blockType: 'BRANCH_CODE' }, { blockType: 'BRANCH_CODE' }, run] }),
        ),
        'blocks.1.blockType',
        'DUPLICATE',
      );
      invalid(
        await post(body({ resetRule: 'FINANCIAL_YEAR', blocks: [run] })),
        'blocks',
        'NEEDS_FINANCIAL_YEAR',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'NONSENSE' }, run] })),
        'blocks.0.blockType',
        'INVALID',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'FIXED_TEXT' }, run] })),
        'blocks.0.textValue',
        'REQUIRED',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'FIXED_TEXT', textValue: 'x'.repeat(11) }, run] })),
        'blocks.0.textValue',
        'TOO_LONG',
      );
      for (const text of ['A B', "A'; DROP TABLE patients;--", '<b>', 'ü', 'A\nB']) {
        invalid(
          await post(body({ blocks: [{ blockType: 'FIXED_TEXT', textValue: text }, run] })),
          'blocks.0.textValue',
        );
      }
      invalid(
        await post(body({ blocks: [{ blockType: 'BRANCH_CODE', textValue: 'X' }, run] })),
        'blocks.0.textValue',
        'INVALID',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'CALENDAR_YEAR', fyStyle: 'LONG' }, run] })),
        'blocks.0.fyStyle',
        'INVALID',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'FINANCIAL_YEAR', fyStyle: 'HUGE' }, run] })),
        'blocks.0.fyStyle',
        'INVALID',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'RUNNING_NUMBER', minWidth: 0 }] })),
        'blocks.0.minWidth',
        'INVALID',
      );
      invalid(
        await post(body({ blocks: [{ blockType: 'RUNNING_NUMBER', minWidth: 13 }] })),
        'blocks.0.minWidth',
        'INVALID',
      );
      invalid(
        await post(
          body({ blocks: [{ blockType: 'SEPARATOR', textValue: '-', minWidth: 3 }, run] }),
        ),
        'blocks.0.minWidth',
        'INVALID',
      );
      // too long once printed: 10 + 10 + 10 text plus a 12 wide number
      invalid(
        await post(
          body({
            blocks: [
              { blockType: 'FIXED_TEXT', textValue: 'ABCDEFGHIJ' },
              { blockType: 'BRANCH_CODE' },
              { blockType: 'FIXED_TEXT', textValue: 'KLMNOPQRST' },
              { blockType: 'RUNNING_NUMBER', minWidth: 12 },
            ],
          }),
        ),
        'blocks',
        'TOO_LONG',
      );
      expect(await owner.uhidFormatConfig.count({ where: { tenantId: A.tenant } })).toBe(before);
    });

    it('two formats saved at the same moment: every reader sees the same one', async () => {
      const make = (text: string) => ({
        resetRule: 'NEVER',
        blocks: [
          { blockType: 'FIXED_TEXT', textValue: text },
          { blockType: 'RUNNING_NUMBER', minWidth: 3 },
        ],
      });
      const [one, two] = await Promise.all([
        call('post', B, 'admin', '/settings/uhid-format', make('RA')),
        call('post', B, 'admin', '/settings/uhid-format', make('RB')),
      ]);
      expect(one.status).toBe(200);
      expect(two.status).toBe(200);
      const seen = new Set<string>();
      for (let i = 0; i < 5; i++) {
        seen.add((await get(B, i % 2 ? 'reader' : 'admin', '/settings/uhid-format')).body.example);
      }
      expect(seen.size).toBe(1);
      expect(['RA001', 'RB001']).toContain([...seen][0]);
    });

    it('does not let the body choose the hospital, branch, user or time', async () => {
      const res = await call('post', B, 'admin', '/settings/uhid-format', {
        ...body(),
        tenantId: A.tenant,
        createdBy: A.users.admin,
        effectiveFrom: '2000-01-01T00:00:00Z',
      });
      expect(res.status).toBe(200);
      const row = (await owner.uhidFormatConfig.findMany({ where: { tenantId: B.tenant } }))[0]!;
      expect(row.createdBy).toBe(B.users.admin);
      expect(row.effectiveFrom.getFullYear()).toBeGreaterThan(2020);
    });
  });
});
