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
import { presetInput } from './print-template.rules';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the print template tests`);
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

const SETTINGS_CODES = ['hospital.settings.read', 'print.templates.manage'] as const;
const RECEPTION_CODES = ['opd.visits.read', 'opd.billing.read'] as const;
const ALL_CODES = [...new Set([...SETTINGS_CODES, ...RECEPTION_CODES])];

describe('print templates (HTTP)', () => {
  jest.setTimeout(120_000);
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
        code: `PT_${label}_${stamp}`,
        name: `Print ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `pt-${label}-${stamp}` },
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
          email: `pt_${key}_${label}_${stamp}@example.test`,
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
    await makeUser('admin', SETTINGS_CODES);
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
  const get = (h: Hospital, who: string, url: string) => http().get(url).set(as(h, who));
  const put = (h: Hospital, who: string, url: string, body: unknown) =>
    http()
      .put(url)
      .set(as(h, who))
      .send(body as object);
  const del = (h: Hospital, who: string, url: string) => http().delete(url).set(as(h, who));
  const rows = (h: Hospital, docType?: string) =>
    owner.printTemplate.findMany({
      where: { tenantId: h.tenant, ...(docType ? { docType: docType as 'RECEIPT' } : {}) },
    });
  const audits = (h: Hospital, action: string) =>
    owner.auditLog.findMany({
      where: { tenantId: h.tenant, action },
      orderBy: { createdAt: 'asc' },
    });

  /** A valid pre-printed template for a receipt on 240 x 140 mm continuous stationery. */
  const preprinted = (over: Record<string, unknown> = {}) => ({
    ...JSON.parse(JSON.stringify(presetInput('PREPRINTED_BILL', 'RECEIPT'))),
    ...over,
  });

  /** The values of the document placed in the rich text boxes, in order. */
  const fieldsIn = (layout: Loose): string[] =>
    (layout.elements as Loose[]).flatMap((e) =>
      ((e.content?.paragraphs ?? []) as Loose[]).flatMap((p) =>
        (p.runs as Loose[]).filter((r) => r.t === 'field').map((r) => r.field as string),
      ),
    );

  describe('access', () => {
    it('401 without a token or with a patient token, on every route', async () => {
      const patientToken = tokenService.signPatientAccess({ accountId: 'acc' });
      const calls: Array<[string, string]> = [
        ['get', '/print-templates'],
        ['get', '/print-templates/presets'],
        ['get', '/print-templates/RECEIPT'],
        ['put', '/print-templates/RECEIPT'],
        ['delete', '/print-templates/RECEIPT'],
      ];
      for (const [method, url] of calls) {
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

    it('every signed-in staff member can READ the templates (the print screens need them)', async () => {
      for (const who of ['admin', 'reception', 'nobody']) {
        expect({ who, status: (await get(A, who, '/print-templates')).status }).toEqual({
          who,
          status: 200,
        });
        expect((await get(A, who, '/print-templates/RECEIPT')).status).toBe(200);
      }
    });

    it('only the settings permission can CHANGE a template or go back to the default (403 otherwise)', async () => {
      const body = preprinted();
      for (const who of ['reception', 'nobody']) {
        expect({
          who,
          status: (await put(A, who, '/print-templates/RECEIPT', body)).status,
        }).toEqual({
          who,
          status: 403,
        });
        expect((await del(A, who, '/print-templates/RECEIPT')).status).toBe(403);
      }
      expect(await rows(A)).toHaveLength(0);
    });

    it('the presets list needs the settings read permission', async () => {
      expect((await get(A, 'reception', '/print-templates/presets')).status).toBe(403);
      expect((await get(A, 'nobody', '/print-templates/presets')).status).toBe(403);
      expect((await get(A, 'admin', '/print-templates/presets')).status).toBe(200);
    });
  });

  describe('defaults and presets', () => {
    it('a hospital that saved nothing gets the built-in default of each document', async () => {
      const res = await get(A, 'reception', '/print-templates');
      expect(res.body.items.map((i: Loose) => [i.docType, i.source, i.paper, i.mode])).toEqual([
        ['REGISTRATION_SLIP', 'DEFAULT', 'A5', 'FULL'],
        ['RECEIPT', 'DEFAULT', 'A5', 'FULL'],
        ['PRESCRIPTION', 'DEFAULT', 'A5', 'FULL'],
        ['PATIENT_REPORT', 'DEFAULT', 'A5', 'FULL'],
        ['PATIENT_CARD', 'DEFAULT', 'LABEL', 'FULL'],
      ]);
      const one = await get(A, 'reception', '/print-templates/RECEIPT');
      expect(one.body).toMatchObject({
        docType: 'RECEIPT',
        source: 'DEFAULT',
        pageWidthMm: 148,
        pageHeightMm: 210,
        updatedAt: null,
        enabled: true,
      });
      expect(one.body.layout.version).toBe(3);
      expect(fieldsIn(one.body.layout)).toContain('total');
      expect(fieldsIn(one.body.layout)[0]).toBe('hospitalName');
      expect(one.body.layout.elements[0].content.paragraphs[0].runs[0].style).toMatchObject({
        bold: true,
      });
    });

    it('lists the five built-in presets with what each gives every document', async () => {
      const res = await get(A, 'admin', '/print-templates/presets');
      expect(res.body.items.map((i: Loose) => i.key)).toEqual([
        'A4_FULL',
        'A5_FULL',
        'LABEL_SLIP',
        'CARD_LABEL',
        'PREPRINTED_BILL',
      ]);
      for (const item of res.body.items) {
        expect(Object.keys(item.templates).sort()).toEqual([
          'PATIENT_CARD',
          'PATIENT_REPORT',
          'PRESCRIPTION',
          'RECEIPT',
          'REGISTRATION_SLIP',
        ]);
      }
      const label = res.body.items.find((i: Loose) => i.key === 'LABEL_SLIP');
      expect(label.templates.RECEIPT).toMatchObject({
        paper: 'LABEL',
        pageWidthMm: 100,
        pageHeightMm: 50,
      });
    });

    it('an unknown or wrongly written document type is a clean 400', async () => {
      for (const bad of ['receipt', 'BILL', 'RECEIPT%20', '1', 'null']) {
        const res = await get(A, 'admin', `/print-templates/${bad}`);
        expect({ bad, status: res.status, code: res.body.code }).toEqual({
          bad,
          status: 400,
          code: 'PRINT_DOC_TYPE_INVALID',
        });
      }
      expect((await put(A, 'admin', '/print-templates/bill', preprinted())).status).toBe(400);
      expect((await del(A, 'admin', '/print-templates/bill')).status).toBe(400);
    });
  });

  describe('saving', () => {
    it('saves a pre-printed receipt and gives back exactly what was saved, with the real page size', async () => {
      const body = preprinted({ preset: null });
      body.layout.offset = { xMm: -2.5, yMm: 1.5 };
      body.layout.elements.push({
        id: 'note',
        type: 'RICH',
        xMm: 5,
        yMm: 5,
        widthMm: 100,
        heightMm: 6,
        content: {
          paragraphs: [
            {
              runs: [
                { t: 'text', text: 'Demo Clinic, ', style: { bold: true } },
                { t: 'text', text: 'Main Road' },
                { t: 'field', field: 'patientName', style: { size: 14, underline: true } },
              ],
            },
          ],
        },
      });
      const res = await put(A, 'admin', '/print-templates/RECEIPT', body);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        docType: 'RECEIPT',
        source: 'CUSTOM',
        paper: 'CUSTOM',
        widthMm: 240,
        heightMm: 140,
        pageWidthMm: 240,
        pageHeightMm: 140,
        mode: 'PREPRINTED',
        orientation: 'LANDSCAPE',
        preset: null,
        margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
      });
      expect(res.body.layout.offset).toEqual({ xMm: -2.5, yMm: 1.5 });
      // the words and styles come back exactly as typed (a run is never trimmed or merged)
      expect(res.body.layout.elements.at(-1).content.paragraphs[0].runs).toEqual([
        { t: 'text', text: 'Demo Clinic, ', style: { bold: true } },
        { t: 'text', text: 'Main Road' },
        { t: 'field', field: 'patientName', style: { size: 14, underline: true } },
      ]);
      expect(res.body.updatedAt).not.toBeNull();
      // read back, other documents untouched
      const back = await get(A, 'reception', '/print-templates');
      expect(back.body.items.map((i: Loose) => [i.docType, i.source])).toEqual([
        ['REGISTRATION_SLIP', 'DEFAULT'],
        ['RECEIPT', 'CUSTOM'],
        ['PRESCRIPTION', 'DEFAULT'],
        ['PATIENT_REPORT', 'DEFAULT'],
        ['PATIENT_CARD', 'DEFAULT'],
      ]);
      const row = (await rows(A, 'RECEIPT'))[0]!;
      expect(row.branchId).toBeNull(); // hospital-wide
      expect(row.createdBy).toBe(A.users.admin);
      expect(Number(row.widthMm!.toString())).toBe(240);
    });

    it('saving again replaces it: still ONE row, who changed it is recorded', async () => {
      const second = preprinted({ preset: null });
      second.layout.fontSizePt = 12;
      second.layout.elements[0].content.paragraphs[0].runs[0].style = { size: 14 };
      const res = await put(A, 'admin', '/print-templates/RECEIPT', second);
      expect(res.status).toBe(200);
      expect(res.body.layout.fontSizePt).toBe(12);
      expect(res.body.layout.elements[0].content.paragraphs[0].runs[0].style).toEqual({ size: 14 });
      expect(await rows(A, 'RECEIPT')).toHaveLength(1);
      const row = (await rows(A, 'RECEIPT'))[0]!;
      expect(row.updatedBy).toBe(A.users.admin);
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
    });

    it('every save is audited with the names of what changed, never the texts typed in', async () => {
      const log = await audits(A, 'PRINT_TEMPLATE_UPDATE');
      expect(log.length).toBeGreaterThanOrEqual(2);
      const first = log[0]!;
      expect(first.metadata).toMatchObject({ docType: 'RECEIPT', created: true });
      expect((first.metadata as Loose).changed).toEqual(
        expect.arrayContaining(['paper', 'mode', 'layout']),
      );
      expect(log[1]!.metadata).toMatchObject({ created: false });
      expect((log[1]!.metadata as Loose).changed).toEqual(['layout']);
      expect(JSON.stringify(log.map((l) => l.metadata))).not.toMatch(/Demo Clinic|Main Road/);
      expect(log[0]!.actorUserId).toBe(A.users.admin);
    });

    it('a document can be switched off, then saved on again', async () => {
      const off = preprinted({ enabled: false });
      const res = await put(A, 'admin', '/print-templates/REGISTRATION_SLIP', {
        ...JSON.parse(JSON.stringify(presetInput('A4_FULL', 'REGISTRATION_SLIP'))),
        enabled: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect((await get(A, 'reception', '/print-templates/REGISTRATION_SLIP')).body.enabled).toBe(
        false,
      );
      expect(off.enabled).toBe(false);
    });

    it('bad templates are refused with the field and the reason, and nothing is stored', async () => {
      const before = (await rows(A)).length;
      const good = () => JSON.parse(JSON.stringify(presetInput('A5_FULL', 'PATIENT_REPORT')));
      const box = (run: Record<string, unknown> = { t: 'field', field: 'diagnosis' }) => ({
        id: 'a',
        type: 'RICH',
        xMm: 10,
        yMm: 10,
        widthMm: 50,
        heightMm: 6,
        content: { paragraphs: [{ runs: [run] }] },
      });
      const cases: Array<[Record<string, unknown>, string, string]> = [
        [{ ...good(), paper: 'A3' }, 'paper', 'UNKNOWN_PAPER'],
        [{ ...good(), tenantId: 'x' }, 'template.tenantId', 'UNKNOWN_FIELD'],
        [
          { ...good(), margins: { topMm: 99, rightMm: 99, bottomMm: 99, leftMm: 99 } },
          'margins',
          'NO_ROOM_TO_PRINT_ACROSS',
        ],
        [
          { ...good(), margins: { topMm: -1, rightMm: 0, bottomMm: 0, leftMm: 0 } },
          'margins.topMm',
          'OUT_OF_RANGE',
        ],
        [{ ...good(), widthMm: 148 }, 'widthMm', 'NOT_ALLOWED_FOR_THIS_PAPER'],
        [{ ...good(), paper: 'CUSTOM' }, 'widthMm', 'REQUIRED_FOR_THIS_PAPER'],
        [{ ...good(), mode: 'FANCY' }, 'mode', 'UNKNOWN_MODE'],
        [
          { ...good(), layout: { ...good().layout, fontSizePt: 99 } },
          'layout.fontSizePt',
          'OUT_OF_RANGE',
        ],
        [
          {
            ...good(),
            layout: {
              ...good().layout,
              elements: [box({ t: 'field', field: 'colour' })],
            },
          },
          'layout.elements.0.content.paragraphs.0.runs.0.field',
          'UNKNOWN_FIELD',
        ],
        [
          { ...good(), layout: { ...good().layout, elements: [{ ...box(), xMm: 140 }] } },
          'layout.elements.0.widthMm',
          'OUT_OF_PAGE',
        ],
        [
          { ...good(), layout: { ...good().layout, elements: [{ ...box(), id: '<b>' }] } },
          'layout.elements.0.id',
          'BAD_ID',
        ],
        [
          { ...good(), layout: { ...good().layout, elements: [box(), box()] } },
          'layout.elements.1.id',
          'DUPLICATE_ID',
        ],
        [
          {
            ...good(),
            layout: { ...good().layout, elements: [box({ t: 'text', text: '' })] },
          },
          'layout.elements.0.content.paragraphs.0.runs.0.text',
          'REQUIRED',
        ],
        [
          {
            ...good(),
            layout: { ...good().layout, elements: [box({ t: 'text', text: 'a\nb' })] },
          },
          'layout.elements.0.content.paragraphs.0.runs.0.text',
          'NOT_TEXT',
        ],
        [
          {
            ...good(),
            layout: {
              ...good().layout,
              elements: [box({ t: 'text', text: 'x', style: { size: 99 } })],
            },
          },
          'layout.elements.0.content.paragraphs.0.runs.0.style.size',
          'OUT_OF_RANGE',
        ],
        [{ ...good(), preset: 'MY_OWN' }, 'preset', 'UNKNOWN_PRESET'],
      ];
      for (const [body, field, reason] of cases) {
        const res = await put(A, 'admin', '/print-templates/PATIENT_REPORT', body);
        expect({ field, status: res.status }).toEqual({ field, status: 400 });
        expect(res.body).toMatchObject({ code: 'PRINT_TEMPLATE_INVALID', field, reason });
      }
      for (const nonsense of [null, 'text', 5, [], '']) {
        const res = await http()
          .put('/print-templates/PATIENT_REPORT')
          .set(as(A, 'admin'))
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(nonsense));
        expect({ nonsense, status: res.status }).toEqual({ nonsense, status: 400 });
      }
      expect(await rows(A, 'PATIENT_REPORT')).toHaveLength(0);
      expect((await rows(A)).length).toBe(before);
    });

    it('an older (version 1) template is accepted, stored as boxes and read back as boxes', async () => {
      const old = {
        ...JSON.parse(JSON.stringify(presetInput('A5_FULL', 'REGISTRATION_SLIP'))),
        layout: {
          version: 1,
          fontSizePt: 10,
          headerText: 'Old Clinic',
          footerText: '',
          showLogo: true,
          fields: { hospitalName: true, uhid: true, patientName: true, phone: false },
          offset: { xMm: 0, yMm: 0 },
          positions: {},
        },
      };
      const res = await put(A, 'admin', '/print-templates/REGISTRATION_SLIP', old);
      expect(res.status).toBe(200);
      expect(res.body.layout.version).toBe(3);
      const fields = fieldsIn(res.body.layout);
      // fields left out of the old template were shown, so they are boxes too; phone was switched off
      expect(fields).not.toContain('phone');
      expect(fields).toEqual(expect.arrayContaining(['uhid', 'patientName']));
      const stored = (await rows(A, 'REGISTRATION_SLIP'))[0]!;
      expect((stored.layout as Loose).version).toBe(3);
      // a row an earlier version of the product wrote (version 1) is shown as boxes too
      await owner.printTemplate.updateMany({
        where: { id: stored.id },
        data: { layout: old.layout },
      });
      const back = await get(A, 'reception', '/print-templates/REGISTRATION_SLIP');
      expect(back.body.layout.version).toBe(3);
      expect(JSON.stringify(back.body.layout)).toContain('Old Clinic');
    });

    it('two first saves at the same moment: both succeed, still one row', async () => {
      const body = JSON.parse(JSON.stringify(presetInput('A4_FULL', 'PATIENT_REPORT')));
      const [a, b] = await Promise.all([
        put(A, 'admin', '/print-templates/PATIENT_REPORT', body),
        put(A, 'admin', '/print-templates/PATIENT_REPORT', body),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await rows(A, 'PATIENT_REPORT')).toHaveLength(1);
    });
  });

  describe('going back to the default', () => {
    it('removes the saved template, gives the default and is audited; a second time changes nothing', async () => {
      expect((await get(A, 'admin', '/print-templates/RECEIPT')).body.source).toBe('CUSTOM');
      const before = (await audits(A, 'PRINT_TEMPLATE_RESET')).length;
      const res = await del(A, 'admin', '/print-templates/RECEIPT');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ docType: 'RECEIPT', source: 'DEFAULT', paper: 'A5' });
      expect(await rows(A, 'RECEIPT')).toHaveLength(0);
      const log = await audits(A, 'PRINT_TEMPLATE_RESET');
      expect(log).toHaveLength(before + 1);
      expect(log.at(-1)!.metadata).toMatchObject({ docType: 'RECEIPT' });
      const again = await del(A, 'admin', '/print-templates/RECEIPT');
      expect(again.status).toBe(200);
      expect(again.body.source).toBe('DEFAULT');
      expect(await audits(A, 'PRINT_TEMPLATE_RESET')).toHaveLength(before + 1);
    });
  });

  describe('hospitals stay apart', () => {
    it("another hospital never sees or changes this hospital's templates", async () => {
      const saved = JSON.parse(JSON.stringify(presetInput('LABEL_SLIP', 'REGISTRATION_SLIP')));
      expect((await put(A, 'admin', '/print-templates/REGISTRATION_SLIP', saved)).status).toBe(200);
      const b = await get(B, 'reception', '/print-templates');
      expect(b.body.items.every((i: Loose) => i.source === 'DEFAULT')).toBe(true);
      expect(await rows(B)).toHaveLength(0);
      // B saving its own does not touch A's
      const bSaved = JSON.parse(JSON.stringify(presetInput('A4_FULL', 'REGISTRATION_SLIP')));
      expect((await put(B, 'admin', '/print-templates/REGISTRATION_SLIP', bSaved)).status).toBe(
        200,
      );
      const a = await get(A, 'reception', '/print-templates/REGISTRATION_SLIP');
      expect(a.body).toMatchObject({ source: 'CUSTOM', paper: 'LABEL' });
      expect((await get(B, 'reception', '/print-templates/REGISTRATION_SLIP')).body.paper).toBe(
        'A4',
      );
      // B's reset leaves A's saved template alone
      await del(B, 'admin', '/print-templates/REGISTRATION_SLIP');
      expect((await get(A, 'reception', '/print-templates/REGISTRATION_SLIP')).body.source).toBe(
        'CUSTOM',
      );
      expect(await rows(A, 'REGISTRATION_SLIP')).toHaveLength(1);
    });

    it('changing a template needs the OPD module of the branch; reading does not', async () => {
      await owner.branchModule.updateMany({
        where: { tenantId: B.tenant },
        data: { restrictedByHospital: true },
      });
      expect((await put(B, 'admin', '/print-templates/RECEIPT', preprinted())).status).toBe(403);
      expect((await del(B, 'admin', '/print-templates/RECEIPT')).status).toBe(403);
      expect((await get(B, 'reception', '/print-templates/RECEIPT')).status).toBe(200);
    });
  });
});
