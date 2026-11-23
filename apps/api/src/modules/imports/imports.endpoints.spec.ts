import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { deflateRawSync } from 'node:zlib';
import { config as loadEnv } from 'dotenv';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CLOCK, FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { ensureSystemRolesForTenant } from '../../../prisma/seeds/reference';
import { localDate } from '../opd-prices/local-date';
import { IMPORT_LIMITS } from './import.config';
import { ImportsService } from './imports.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the import tests`);
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

type Hospital = {
  tenant: string;
  main: string;
  adminId: string;
  tokens: Record<'admin' | 'mastersOnly' | 'recv', string>;
  regItem: string;
  testPriced: string;
  doc1: { id: string; code: string };
  docInactive: { id: string; code: string };
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Excel upload of the masters (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let imports: ImportsService;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let seq = 0;
  const uniq = (p: string) => `${p}${stamp}${(seq += 1)}`;
  let A: Hospital;
  let B: Hospital;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const today = () => localDate(clock.now(), 'Asia/Kolkata');
  const addDays = (date: string, days: number): string => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const later = (ms = 60_000) => clock.set(new Date(clock.now().getTime() + ms));

  // ------------------------------------------------------------------------- fixtures

  async function baseHospital(label: string) {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `IM_${label}_${stamp}`,
        name: `Imports ${label}`,
        isTest: true,
        branches: {
          create: [{ code: 'MAIN', name: 'Main', isMain: true, accessCode: uniq(`im-${label}-`) }],
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
    await owner.opdSettings.create({
      data: { tenantId: tenant, followUpFreeDays: 7, tokenPrefix: 'T', timezone: 'Asia/Kolkata' },
    });
    const { superAdminRoleId } = await ensureSystemRolesForTenant(owner, tenant);
    const admin = await owner.user.create({
      data: {
        tenantId: tenant,
        code: 'SA1',
        email: `${uniq('sa')}@example.test`,
        displayName: 'First SuperAdmin',
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({ data: { tenantId: tenant, userId: admin.id, branchId: main } });
    await owner.roleAssignment.create({
      data: { tenantId: tenant, userId: admin.id, roleId: superAdminRoleId, scopeType: 'HOSPITAL' },
    });
    return { tenant, main, adminId: admin.id };
  }

  async function makeUser(
    base: { tenant: string; main: string },
    key: string,
    permissions: readonly string[],
  ): Promise<string> {
    const u = await owner.user.create({
      data: {
        tenantId: base.tenant,
        code: `${key}${stamp}${(seq += 1)}`.slice(0, 40),
        email: `${uniq(key)}@example.test`,
        displayName: `Person ${key}`,
        passwordHash: 'x',
      },
    });
    await owner.userBranch.create({
      data: { tenantId: base.tenant, userId: u.id, branchId: base.main },
    });
    if (permissions.length > 0) {
      const perms = await owner.permission.findMany({ where: { code: { in: [...permissions] } } });
      const role = await owner.role.create({
        data: { tenantId: base.tenant, code: uniq(`R_${key}_`), name: key },
      });
      for (const p of perms) {
        await owner.rolePermission.create({
          data: { tenantId: base.tenant, roleId: role.id, permissionId: p.id },
        });
      }
      const a = await owner.roleAssignment.create({
        data: { tenantId: base.tenant, userId: u.id, roleId: role.id, scopeType: 'BRANCH' },
      });
      await owner.roleAssignmentBranch.create({
        data: { tenantId: base.tenant, assignmentId: a.id, branchId: base.main },
      });
    }
    return tokenService.signHospitalAccess({
      tenantId: base.tenant,
      userId: u.id,
      branchId: base.main,
    });
  }

  async function makeDoctor(
    base: { tenant: string; main: string },
    key: string,
    active = true,
  ): Promise<{ id: string; code: string }> {
    const u = await owner.user.create({
      data: {
        tenantId: base.tenant,
        code: `${key}${stamp}${(seq += 1)}`.slice(0, 40),
        email: `${uniq(key)}@example.test`,
        displayName: `Dr ${key}`,
        passwordHash: 'x',
      },
    });
    const code = uniq(`D${key}`).slice(0, 38);
    const profile = await owner.doctorProfile.create({
      data: { tenantId: base.tenant, userId: u.id, code, active },
    });
    return { id: profile.id, code };
  }

  async function seedHospital(label: string): Promise<Hospital> {
    const base = await baseHospital(label);
    const regItem = (
      await owner.chargeItem.create({
        data: { tenantId: base.tenant, code: 'REG', name: 'Registration', kind: 'REGISTRATION' },
      })
    ).id;
    const testPriced = (
      await owner.chargeItem.create({
        data: { tenantId: base.tenant, code: 'TB', name: 'X-ray chest', kind: 'INVESTIGATION' },
      })
    ).id;
    await owner.chargeItemPrice.create({
      data: {
        tenantId: base.tenant,
        chargeItemId: testPriced,
        amountPaise: 30_000,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        createdBy: base.adminId,
      },
    });
    const doc1 = await makeDoctor(base, 'one');
    const docInactive = await makeDoctor(base, 'off', false);
    const tokens = {
      admin: tokenService.signHospitalAccess({
        tenantId: base.tenant,
        userId: base.adminId,
        branchId: base.main,
      }),
      mastersOnly: await makeUser(base, 'mast', ['opd.masters.write']),
      recv: await makeUser(base, 'recv', ['opd.visits.read', 'opd.billing.read']),
    };
    return { ...base, tokens, regItem, testPriced, doc1, docInactive };
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
    imports = app.get(ImportsService);
    A = await seedHospital('A');
    B = await seedHospital('B');
  });

  afterAll(async () => {
    await imports.idle();
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(() => {
    clock.set(new Date());
  });

  // ---------------------------------------------------------------- file builders

  const text = (s: string): ExcelJS.CellValue => ({ richText: [{ text: s }] });

  async function xlsx(rows: unknown[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Data');
    for (const row of rows) {
      sheet.addRow(row.map((v) => (typeof v === 'string' ? text(v) : v)) as ExcelJS.CellValue[]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const TEST_HEAD = ['Code', 'Name', 'Price', 'Start date', 'Active'];
  const FEE_HEAD = ['Doctor code', 'Visit type', 'Fee', 'Start date'];
  const MED_HEAD = ['Code', 'Name', 'Composition', 'Form', 'Active'];

  const testsFile = (rows: unknown[][]) => xlsx([TEST_HEAD, ...rows]);
  const feesFile = (rows: unknown[][]) => xlsx([FEE_HEAD, ...rows]);
  const medsFile = (rows: unknown[][]) => xlsx([MED_HEAD, ...rows]);

  const send = (token: string, type: string, file: Buffer | null, name = 'list.xlsx') => {
    const req = http().post(`/imports/${type}/upload`).set(auth(token));
    return file ? req.attach('file', file, { filename: name, contentType: XLSX }) : req;
  };

  /** Upload, wait for the background read, return the batch as the API shows it. */
  async function uploaded(token: string, type: string, file: Buffer, name?: string) {
    const res = await send(token, type, file, name).expect(202);
    await imports.idle();
    const batch = await http().get(`/imports/${res.body.id}`).set(auth(token)).expect(200);
    return batch.body as {
      id: string;
      status: string;
      runStatus: string | null;
      totalRows: number;
      validRows: number;
      exceptionRows: number;
      errorMessage: string | null;
      unchangedRows: number;
    };
  }

  const rowsOf = async (token: string, id: string, status?: string) =>
    (
      await http()
        .get(`/imports/${id}/rows${status ? `?status=${status}` : ''}`)
        .set(auth(token))
        .expect(200)
    ).body.items as Array<{
      rowNumber: number;
      matchKey: string;
      status: string;
      action: string | null;
      reason: string | null;
      field: string | null;
      values: Record<string, unknown>;
    }>;

  async function approveAndPost(token: string, id: string) {
    await http().post(`/imports/${id}/approve`).set(auth(token)).expect(200);
    await http().post(`/imports/${id}/post`).set(auth(token)).expect(202);
    await imports.idle();
    return (await http().get(`/imports/${id}`).set(auth(token)).expect(200)).body;
  }

  const reasonsByRow = (rows: Array<{ rowNumber: number; reason: string | null }>) =>
    Object.fromEntries(rows.map((r) => [r.rowNumber, r.reason]));

  // ------------------------------------------------------------------ who may use it

  it('is for Admin and SuperAdmin only: others get 403, no token gets 401, on every route', async () => {
    const file = await medsFile([[uniq('P'), 'Test', '', '', '']]);
    const calls: Array<() => request.Test> = [
      () => http().get('/imports'),
      () => http().get('/imports/templates/MEDICINES'),
      () => send('x', 'MEDICINES', file),
      () => http().get('/imports/someid'),
      () => http().get('/imports/someid/rows'),
      () => http().post('/imports/someid/approve'),
      () => http().post('/imports/someid/post'),
      () => http().post('/imports/someid/cancel'),
    ];
    for (const call of calls) {
      await call().expect(401);
    }
    const asRecv: Array<() => request.Test> = [
      () => http().get('/imports').set(auth(A.tokens.recv)),
      () => http().get('/imports/templates/MEDICINES').set(auth(A.tokens.recv)),
      () => send(A.tokens.recv, 'MEDICINES', file),
      () => http().post('/imports/someid/post').set(auth(A.tokens.recv)),
    ];
    for (const call of asRecv) {
      await call().expect(403);
    }
    expect(await owner.importBatch.count({ where: { tenantId: A.tenant } })).toBe(0);
  });

  it('the price lists need the price permission too; medicines need only the masters permission', async () => {
    await send(
      A.tokens.mastersOnly,
      'TESTS',
      await testsFile([[uniq('X'), 'N', 100, '', '']]),
    ).expect(403);
    await send(A.tokens.mastersOnly, 'DOCTOR_FEES', await feesFile([['a', 'NEW', 100, '']])).expect(
      403,
    );
    const med = await uploaded(
      A.tokens.mastersOnly,
      'MEDICINES',
      await medsFile([[uniq('P'), 'Ok', '', '', '']]),
    );
    expect(med.status).toBe('PREVIEWED');
    // a price batch made by an Admin is hidden from, and untouchable by, a masters-only person
    const priced = await uploaded(
      A.tokens.admin,
      'TESTS',
      await testsFile([[uniq('X'), 'N', 100, '', '']]),
    );
    await http().get(`/imports/${priced.id}`).set(auth(A.tokens.mastersOnly)).expect(403);
    await http().post(`/imports/${priced.id}/approve`).set(auth(A.tokens.mastersOnly)).expect(403);
    const list = await http()
      .get('/imports?pageSize=100')
      .set(auth(A.tokens.mastersOnly))
      .expect(200);
    expect((list.body.items as Array<{ type: string }>).every((b) => b.type === 'MEDICINES')).toBe(
      true,
    );
    const adminList = await http()
      .get('/imports?pageSize=100')
      .set(auth(A.tokens.admin))
      .expect(200);
    expect((adminList.body.items as Array<{ type: string }>).some((b) => b.type === 'TESTS')).toBe(
      true,
    );
  });

  // --------------------------------------------------------------------- templates

  it('gives a sample file per list that opens in Excel and previews cleanly when uploaded unchanged', async () => {
    for (const [type, head] of [
      ['TESTS', TEST_HEAD],
      ['DOCTOR_FEES', FEE_HEAD],
      ['MEDICINES', MED_HEAD],
    ] as const) {
      const res = await http()
        .get(`/imports/templates/${type}`)
        .set(auth(A.tokens.admin))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain(XLSX);
      expect(res.headers['content-disposition']).toContain('attachment');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as Buffer);
      const first = wb.worksheets[0]!;
      expect(head.map((_, i) => String(first.getCell(1, i + 1).value))).toEqual([...head]);
    }
    await http().get('/imports/templates/NOPE').set(auth(A.tokens.admin)).expect(404);
    const sample = await http()
      .get('/imports/templates/MEDICINES')
      .set(auth(A.tokens.admin))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    // the sample, uploaded as it is, is a valid file (and refused a second time while its batch is active)
    const batch = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      sample.body as Buffer,
      'template.xlsx',
    );
    expect(batch).toMatchObject({ status: 'PREVIEWED', exceptionRows: 0 });
    await send(A.tokens.admin, 'MEDICINES', sample.body as Buffer, 'template.xlsx').expect(409);
    await http().post(`/imports/${batch.id}/cancel`).set(auth(A.tokens.admin)).expect(200);
  });

  // --------------------------------------------------------------------- medicines

  it('medicines: the preview saves nothing; approve then post saves; a corrected file updates by code', async () => {
    const c1 = uniq('M');
    const c2 = uniq('M');
    const c3 = uniq('M');
    const file = await medsFile([
      [c1, 'Paracetamol 500', 'Paracetamol', 'Tablet', ''],
      [c2, 'Amoxicillin 250', 'Amoxicillin', 'Capsule', 'Yes'],
      [c3, 'Old syrup', '', '', 'No'],
    ]);
    const batch = await uploaded(A.tokens.admin, 'MEDICINES', file);
    expect(batch).toMatchObject({
      status: 'PREVIEWED',
      runStatus: null,
      totalRows: 3,
      validRows: 3,
    });
    // nothing is saved at the preview
    expect(
      await owner.medicine.count({ where: { tenantId: A.tenant, code: { in: [c1, c2, c3] } } }),
    ).toBe(0);
    expect((await rowsOf(A.tokens.admin, batch.id)).map((r) => r.action)).toEqual([
      'CREATE',
      'CREATE',
      'CREATE',
    ]);

    const posted = await approveAndPost(A.tokens.admin, batch.id);
    expect(posted).toMatchObject({ status: 'POSTED', runStatus: null, postedRows: 3 });
    const saved = await owner.medicine.findMany({
      where: { tenantId: A.tenant, code: { in: [c1, c2, c3] } },
      orderBy: { code: 'asc' },
    });
    expect(saved).toHaveLength(3);
    expect(saved.find((m) => m.code === c3)!.active).toBe(false);
    expect(saved.find((m) => m.code === c1)!.composition).toBe('Paracetamol');

    // a corrected file: one name changes, one is the same, one is switched on again; never deleted
    const fixed = await medsFile([
      [c1, 'Paracetamol 650', 'Paracetamol', 'Tablet', ''],
      [c2, 'Amoxicillin 250', 'Amoxicillin', 'Capsule', 'Yes'],
      [c3, 'Old syrup', '', '', 'Yes'],
    ]);
    const second = await uploaded(A.tokens.admin, 'MEDICINES', fixed, 'fixed.xlsx');
    expect((await rowsOf(A.tokens.admin, second.id)).map((r) => r.action)).toEqual([
      'UPDATE',
      'NONE',
      'UPDATE',
    ]);
    expect(second.unchangedRows).toBe(1);
    await approveAndPost(A.tokens.admin, second.id);
    expect(
      (await owner.medicine.findFirstOrThrow({ where: { tenantId: A.tenant, code: c1 } })).name,
    ).toBe('Paracetamol 650');
    expect(
      (await owner.medicine.findFirstOrThrow({ where: { tenantId: A.tenant, code: c3 } })).active,
    ).toBe(true);
    expect(
      await owner.medicine.count({ where: { tenantId: A.tenant, code: { in: [c1, c2, c3] } } }),
    ).toBe(3);

    // the same file again is refused while its batch is active, also after it was posted
    await send(A.tokens.admin, 'MEDICINES', fixed, 'fixed.xlsx').expect(409);
    // the audit trail has counts only
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { tenantId: A.tenant, action: 'IMPORT_BATCH_APPLY', entityId: batch.id },
    });
    expect(audit.metadata).toEqual({
      type: 'MEDICINES',
      created: 3,
      updated: 0,
      unchanged: 0,
      priceVersions: 0,
    });
  });

  it('medicine rows: missing or bad values go to the exceptions, the good rows stay', async () => {
    const ok = uniq('M');
    const dup = uniq('M');
    const rows = await medsFile([
      [ok, 'Fine', '', '', ''],
      ['', 'No code', '', '', ''],
      ['bad code!', 'Bad code', '', '', ''],
      [uniq('M'), '', '', '', ''],
      [uniq('M'), 'x'.repeat(IMPORT_LIMITS.nameMax + 1), '', '', ''],
      [uniq('M'), 'Active typo', '', '', 'maybe'],
      [dup, 'Twice A', '', '', ''],
      [dup.toLowerCase(), 'Twice B', '', '', ''],
    ]);
    const batch = await uploaded(A.tokens.admin, 'MEDICINES', rows, 'bad.xlsx');
    expect(batch).toMatchObject({ totalRows: 8, validRows: 1, exceptionRows: 7 });
    const bad = await rowsOf(A.tokens.admin, batch.id, 'EXCEPTION');
    expect(reasonsByRow(bad)).toEqual({
      3: 'CODE_REQUIRED',
      4: 'CODE_INVALID',
      5: 'NAME_REQUIRED',
      6: 'TOO_LONG',
      7: 'ACTIVE_INVALID',
      8: 'DUPLICATE_IN_FILE',
      9: 'DUPLICATE_IN_FILE',
    });
    await approveAndPost(A.tokens.admin, batch.id);
    expect(
      await owner.medicine.findFirst({ where: { tenantId: A.tenant, code: ok } }),
    ).not.toBeNull();
    expect(
      await owner.medicine.count({
        where: { tenantId: A.tenant, code: { in: [dup, dup.toLowerCase()] } },
      }),
    ).toBe(0);
  });

  it('text that starts with = + - or @ is kept as plain text; a real formula is refused', async () => {
    const c1 = uniq('F');
    const c2 = uniq('F');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Data');
    sheet.addRow(MED_HEAD);
    sheet.addRow([text(c1), text('=SUM(1+1)'), text('@cmd'), text('-1+1'), text('')]);
    sheet.addRow([text(c2), { formula: '1+1', result: 2 }, '', '', '']);
    const batch = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      Buffer.from(await wb.xlsx.writeBuffer()),
      'formulas.xlsx',
    );
    const rows = await rowsOf(A.tokens.admin, batch.id);
    expect(rows[0]).toMatchObject({
      status: 'VALID',
      values: { name: '=SUM(1+1)', composition: '@cmd', form: '-1+1' },
    });
    expect(rows[1]).toMatchObject({
      status: 'EXCEPTION',
      reason: 'FORMULA_NOT_ALLOWED',
      field: 'name',
    });
    await approveAndPost(A.tokens.admin, batch.id);
    const saved = await owner.medicine.findFirstOrThrow({
      where: { tenantId: A.tenant, code: c1 },
    });
    expect(saved.name).toBe('=SUM(1+1)'); // text, exactly as typed
    expect(await owner.medicine.count({ where: { tenantId: A.tenant, code: c2 } })).toBe(0);
  });

  // ------------------------------------------------------------------ tests and prices

  it('tests: a new test and its first price, a new price version for an old test, an unchanged price makes no version', async () => {
    const fresh = uniq('T');
    const same = uniq('T');
    await owner.chargeItem
      .create({
        data: { tenantId: A.tenant, code: same, name: 'Same price', kind: 'INVESTIGATION' },
      })
      .then((item) =>
        owner.chargeItemPrice.create({
          data: {
            tenantId: A.tenant,
            chargeItemId: item.id,
            amountPaise: 12_550,
            effectiveFrom: new Date('2020-01-01T00:00:00Z'),
            createdBy: A.adminId,
          },
        }),
      );
    const file = await testsFile([
      [fresh, 'Blood sugar', 120, '', ''],
      ['TB', 'X-ray chest', 350.5, '', ''],
      [same, 'Same price', 125.5, '', ''],
    ]);
    const batch = await uploaded(A.tokens.admin, 'TESTS', file);
    expect(batch).toMatchObject({
      status: 'PREVIEWED',
      validRows: 3,
      exceptionRows: 0,
      unchangedRows: 1,
    });
    expect((await rowsOf(A.tokens.admin, batch.id)).map((r) => r.action)).toEqual([
      'CREATE',
      'UPDATE',
      'NONE',
    ]);
    // the preview changed nothing
    expect(await owner.chargeItem.count({ where: { tenantId: A.tenant, code: fresh } })).toBe(0);
    expect(await owner.chargeItemPrice.count({ where: { chargeItemId: A.testPriced } })).toBe(1);

    later(); // the first price of a new item and the change of TB start "now"
    await approveAndPost(A.tokens.admin, batch.id);
    const item = await owner.chargeItem.findFirstOrThrow({
      where: { tenantId: A.tenant, code: fresh },
    });
    expect(item.kind).toBe('INVESTIGATION');
    const prices = await owner.chargeItemPrice.findMany({ where: { chargeItemId: item.id } });
    expect(prices.map((p) => p.amountPaise)).toEqual([12_000]);
    const tb = await owner.chargeItemPrice.findMany({
      where: { chargeItemId: A.testPriced },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(tb.map((p) => p.amountPaise)).toEqual([30_000, 35_050]); // new version, old one untouched
    const sameItem = await owner.chargeItem.findFirstOrThrow({
      where: { tenantId: A.tenant, code: same },
    });
    expect(await owner.chargeItemPrice.count({ where: { chargeItemId: sameItem.id } })).toBe(1);
    // the price changes are in the audit trail like any price change
    expect(
      await owner.auditLog.count({
        where: { tenantId: A.tenant, action: 'OPD_PRICE_CHANGE', entityType: 'charge_item_price' },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('a big list (800 new tests) previews and posts well inside the transaction limit, all or nothing', async () => {
    const tag = uniq('BIG');
    const rows = Array.from({ length: 800 }, (_, i) => [
      `${tag}${i}`,
      `Big test ${i}`,
      100 + i,
      '',
      '',
    ]);
    const batch = await uploaded(A.tokens.admin, 'TESTS', await testsFile(rows));
    expect(batch).toMatchObject({ status: 'PREVIEWED', validRows: 800, exceptionRows: 0 });
    later();
    const done = await approveAndPost(A.tokens.admin, batch.id);
    expect(done.status).toBe('POSTED');
    expect(
      await owner.chargeItem.count({ where: { tenantId: A.tenant, code: { startsWith: tag } } }),
    ).toBe(800);
    expect(
      await owner.chargeItemPrice.count({
        where: { tenantId: A.tenant, chargeItem: { code: { startsWith: tag } } },
      }),
    ).toBe(800);
  }, 120_000);

  it('tests: bad prices, dates, kinds and codes become exceptions in plain, stable codes', async () => {
    const dated = uniq('T');
    await owner.chargeItem
      .create({ data: { tenantId: A.tenant, code: dated, name: 'Dated', kind: 'INVESTIGATION' } })
      .then((item) =>
        owner.chargeItemPrice.create({
          data: {
            tenantId: A.tenant,
            chargeItemId: item.id,
            amountPaise: 1000,
            effectiveFrom: new Date('2020-01-01T00:00:00Z'),
            createdBy: A.adminId,
          },
        }),
      );
    const future = addDays(today(), 10);
    const rows = [
      [uniq('T'), 'Negative', -5, '', ''], // 3
      [uniq('T'), 'Three decimals', 10.555, '', ''], // 4
      [uniq('T'), 'Words', 'abc', '', ''], // 5
      [uniq('T'), 'No price', '', '', ''], // 6
      [uniq('T'), 'Too big', 21_474_836.48, '', ''], // 7
      [uniq('T'), 'Bad date', 100, 'not a date', ''], // 8
      [uniq('T'), 'Real date, wrong day', 100, '2026-02-30', ''], // 9
      [dated, 'Dated', 2000, addDays(today(), -3), ''], // 10 in the past
      ['REG', 'Registration as test', 50, '', ''], // 11 code of a registration item
      [uniq('T'), 'Fine and scheduled', 100, future, ''], // 12 valid
      [uniq('T'), 'Zero is a price', 0, '', ''], // 13 valid
      [uniq('T'), 'Switched off, no price', '', '', 'No'], // 14 valid
    ];
    const batch = await uploaded(A.tokens.admin, 'TESTS', await testsFile(rows), 'bad-tests.xlsx');
    expect(batch).toMatchObject({ totalRows: 12, validRows: 3, exceptionRows: 9 });
    const bad = await rowsOf(A.tokens.admin, batch.id, 'EXCEPTION');
    // row 1 holds the headings, so the first test is row 2
    expect(reasonsByRow(bad)).toEqual({
      2: 'PRICE_INVALID',
      3: 'PRICE_INVALID',
      4: 'PRICE_INVALID',
      5: 'PRICE_REQUIRED',
      6: 'PRICE_INVALID',
      7: 'DATE_INVALID',
      8: 'DATE_INVALID',
      9: 'DATE_IN_PAST',
      10: 'CODE_USED_BY_OTHER_ITEM',
    });
    expect(bad.find((r) => r.rowNumber === 9)!.field).toBe('startDate');
    expect(bad.find((r) => r.rowNumber === 2)!.field).toBe('price');
  });

  it('tests: a date in the past is fine for the very first price of a new test, and a future date schedules the price', async () => {
    const first = uniq('T');
    const sched = uniq('T');
    const future = addDays(today(), 10);
    const batch = await uploaded(
      A.tokens.admin,
      'TESTS',
      await testsFile([
        [first, 'Old first price', 100, addDays(today(), -30), ''],
        [sched, 'Scheduled', 200, future, ''],
      ]),
      'dates.xlsx',
    );
    expect(batch.exceptionRows).toBe(0);
    later();
    await approveAndPost(A.tokens.admin, batch.id);
    const p1 = await owner.chargeItemPrice.findFirstOrThrow({
      where: { chargeItem: { code: first, tenantId: A.tenant } },
    });
    expect(p1.effectiveFrom.getTime()).toBeLessThan(clock.now().getTime());
    const p2 = await owner.chargeItemPrice.findFirstOrThrow({
      where: { chargeItem: { code: sched, tenantId: A.tenant } },
    });
    expect(p2.effectiveFrom.getTime()).toBeGreaterThan(clock.now().getTime());
  });

  it('tests: Active = No switches a test off by code and never deletes it; its price is left alone', async () => {
    const code = uniq('T');
    const create = await uploaded(
      A.tokens.admin,
      'TESTS',
      await testsFile([[code, 'Soon off', 100, '', '']]),
      'a.xlsx',
    );
    await approveAndPost(A.tokens.admin, create.id);
    later();
    const off = await uploaded(
      A.tokens.admin,
      'TESTS',
      await testsFile([[code, 'Soon off', 999, '', 'No']]),
      'b.xlsx',
    );
    await approveAndPost(A.tokens.admin, off.id);
    const item = await owner.chargeItem.findFirstOrThrow({ where: { tenantId: A.tenant, code } });
    expect(item.active).toBe(false);
    expect(
      (await owner.chargeItemPrice.findMany({ where: { chargeItemId: item.id } })).map(
        (p) => p.amountPaise,
      ),
    ).toEqual([10_000]);
  });

  // ------------------------------------------------------------------ doctor fees

  it('doctor fees: both visit types per doctor, matched by doctor code, saved as new fee versions', async () => {
    const doc = await makeDoctor(A, 'fee');
    const batch = await uploaded(
      A.tokens.admin,
      'DOCTOR_FEES',
      await feesFile([
        [doc.code, 'NEW', 500, ''],
        [doc.code, 'follow-up', 300.5, ''],
      ]),
    );
    expect(batch).toMatchObject({ status: 'PREVIEWED', validRows: 2, exceptionRows: 0 });
    expect(await owner.doctorFee.count({ where: { doctorProfileId: doc.id } })).toBe(0);
    later();
    await approveAndPost(A.tokens.admin, batch.id);
    const fees = await owner.doctorFee.findMany({
      where: { doctorProfileId: doc.id },
      orderBy: { visitType: 'asc' },
    });
    expect(fees.map((f) => [f.visitType, f.amountPaise])).toEqual([
      ['NEW', 50_000],
      ['FOLLOW_UP', 30_050],
    ]);
    // a later upload with a changed NEW fee adds a version; the unchanged FOLLOW_UP adds none
    later();
    const again = await uploaded(
      A.tokens.admin,
      'DOCTOR_FEES',
      await feesFile([
        [doc.code, 'NEW', 600, ''],
        [doc.code, 'FOLLOW_UP', 300.5, ''],
      ]),
      'fees2.xlsx',
    );
    expect((await rowsOf(A.tokens.admin, again.id)).map((r) => r.action)).toEqual([
      'UPDATE',
      'NONE',
    ]);
    await approveAndPost(A.tokens.admin, again.id);
    expect(
      (await owner.doctorFee.findMany({ where: { doctorProfileId: doc.id, visitType: 'NEW' } }))
        .length,
    ).toBe(2);
    expect(
      (
        await owner.doctorFee.findMany({
          where: { doctorProfileId: doc.id, visitType: 'FOLLOW_UP' },
        })
      ).length,
    ).toBe(1);
  });

  it("doctor fees: one type only, unknown or inactive doctor, bad type, duplicates and another hospital's doctor are exceptions", async () => {
    const solo = await makeDoctor(A, 'solo');
    const pair = await makeDoctor(A, 'pair');
    const dup = await makeDoctor(A, 'dup');
    const rows = await feesFile([
      [solo.code, 'NEW', 500, ''], // 2: only one type
      [pair.code, 'NEW', 500, ''], // 3 ok
      [pair.code, 'FOLLOW_UP', 300, ''], // 4 ok
      ['NO_SUCH_DOCTOR', 'NEW', 500, ''], // 5
      [A.docInactive.code, 'NEW', 500, ''], // 6
      [pair.code, 'WEEKLY', 500, ''], // 7
      [dup.code, 'NEW', 500, ''], // 8 duplicate
      [dup.code, 'NEW', 600, ''], // 9 duplicate
      [dup.code, 'FOLLOW_UP', 300, ''], // 10 (its partner rows are exceptions, so only one valid type is left)
      [B.doc1.code, 'NEW', 500, ''], // 11 the other hospital's doctor
      [B.doc1.code, 'FOLLOW_UP', 300, ''], // 12
      [pair.code.toLowerCase(), 'NEW', 1, ''], // 13 a different code (codes match exactly)
    ]);
    const batch = await uploaded(A.tokens.admin, 'DOCTOR_FEES', rows, 'fees-bad.xlsx');
    const bad = reasonsByRow(await rowsOf(A.tokens.admin, batch.id, 'EXCEPTION'));
    expect(bad).toMatchObject({
      2: 'DOCTOR_NEEDS_BOTH_TYPES',
      5: 'DOCTOR_NOT_FOUND',
      6: 'DOCTOR_INACTIVE',
      7: 'VISIT_TYPE_INVALID',
      8: 'DUPLICATE_IN_FILE',
      9: 'DUPLICATE_IN_FILE',
      10: 'DOCTOR_NEEDS_BOTH_TYPES',
      11: 'DOCTOR_NOT_FOUND',
      12: 'DOCTOR_NOT_FOUND',
      13: 'DOCTOR_NOT_FOUND',
    });
    expect(Object.keys(bad)).not.toContain('3');
    expect(Object.keys(bad)).not.toContain('4');
    await approveAndPost(A.tokens.admin, batch.id);
    expect(await owner.doctorFee.count({ where: { doctorProfileId: pair.id } })).toBe(2);
    expect(
      await owner.doctorFee.count({
        where: { doctorProfileId: { in: [solo.id, dup.id, B.doc1.id] } },
      }),
    ).toBe(0);
  });

  // -------------------------------------------------------------- the file itself

  it('refuses what is not a real xlsx before any batch is made', async () => {
    const before = await owner.importBatch.count({ where: { tenantId: A.tenant } });
    const refuse = async (file: Buffer | null, reason: string, name = 'x.xlsx') => {
      const res = await send(A.tokens.admin, 'MEDICINES', file, name).expect(400);
      expect(res.body).toMatchObject({ code: 'IMPORT_FILE_INVALID', reason });
    };
    await refuse(null, 'NO_FILE');
    await refuse(Buffer.from('code,name\nA,B\n'), 'NOT_XLSX', 'list.csv');
    await refuse(Buffer.from('hello'), 'NOT_XLSX');
    // a picture renamed to .xlsx
    await refuse(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]),
      'NOT_XLSX',
    );
    // an old .xls (compound file)
    await refuse(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(64).fill(0)]),
      'NOT_XLSX',
      'old.xls',
    );
    // a zip that is not a workbook
    const plain = new JSZip();
    plain.file('readme.txt', 'hello');
    await refuse(await plain.generateAsync({ type: 'nodebuffer' }), 'NOT_XLSX');
    // a workbook with macros
    const withMacros = new JSZip();
    withMacros.file('[Content_Types].xml', '<Types/>');
    withMacros.file('xl/workbook.xml', '<workbook/>');
    withMacros.file('xl/vbaProject.bin', 'macro');
    await refuse(await withMacros.generateAsync({ type: 'nodebuffer' }), 'MACROS', 'macro.xlsm');
    // external links
    const linked = new JSZip();
    linked.file('[Content_Types].xml', '<Types/>');
    linked.file('xl/workbook.xml', '<workbook/>');
    linked.file('xl/externalLinks/externalLink1.xml', '<x/>');
    await refuse(await linked.generateAsync({ type: 'nodebuffer' }), 'EXTERNAL_CONTENT');
    // a zip bomb: tiny file that says it unpacks to far more than allowed
    const bomb = new JSZip();
    bomb.file('[Content_Types].xml', '<Types/>');
    bomb.file('xl/workbook.xml', '<workbook/>');
    bomb.file(
      'xl/worksheets/sheet1.xml',
      Buffer.alloc(IMPORT_LIMITS.maxUnzippedBytes + 1024, 0x61),
    );
    const bombBytes = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bombBytes.length).toBeLessThan(IMPORT_LIMITS.maxBytes);
    await refuse(bombBytes, 'TOO_BIG_UNPACKED');
    // a file that LIES about its size: the real size is checked, not the stated one
    const liar = new JSZip();
    liar.file('[Content_Types].xml', '<Types/>');
    liar.file('xl/workbook.xml', '<workbook/>');
    liar.file('xl/worksheets/sheet1.xml', Buffer.alloc(200_000, 0x62));
    const liarBytes = await liar.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const eocd = liarBytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let p = liarBytes.readUInt32LE(eocd + 16);
    for (let n = liarBytes.readUInt16LE(eocd + 10); n > 0; n -= 1) {
      const nameLen = liarBytes.readUInt16LE(p + 28);
      const name = liarBytes.toString('utf8', p + 46, p + 46 + nameLen);
      if (name === 'xl/worksheets/sheet1.xml') {
        liarBytes.writeUInt32LE(100, p + 24); // "100 bytes", really 200,000
      }
      p += 46 + nameLen + liarBytes.readUInt16LE(p + 30) + liarBytes.readUInt16LE(p + 32);
    }
    await refuse(liarBytes, 'TOO_BIG_UNPACKED');
    // too many parts
    const many = new JSZip();
    many.file('[Content_Types].xml', '<Types/>');
    many.file('xl/workbook.xml', '<workbook/>');
    for (let i = 0; i < IMPORT_LIMITS.maxZipEntries; i += 1) many.file(`xl/p${i}.xml`, '<x/>');
    await refuse(await many.generateAsync({ type: 'nodebuffer' }), 'TOO_MANY_PARTS');
    // bigger than the size limit (random bytes do not compress)
    const huge = new JSZip();
    huge.file('[Content_Types].xml', '<Types/>');
    huge.file('xl/workbook.xml', '<workbook/>');
    const noise = Buffer.alloc(IMPORT_LIMITS.maxBytes + 4096);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
    huge.file('xl/media/big.bin', noise, { compression: 'STORE' });
    await refuse(await huge.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), 'TOO_BIG');
    // nothing above made a batch or stored anything the hospital could see
    expect(await owner.importBatch.count({ where: { tenantId: A.tenant } })).toBe(before);
    void deflateRawSync;
  });

  it('a workbook with missing columns or too many rows becomes a FAILED batch with the reason; an empty list cannot be approved', async () => {
    const noPrice = await uploaded(
      A.tokens.admin,
      'TESTS',
      await xlsx([
        ['Code', 'Name'],
        ['A1', 'x'],
      ]),
      'noprice.xlsx',
    );
    expect(noPrice).toMatchObject({ status: 'FAILED', runStatus: 'FAILED' });
    expect(noPrice.errorMessage).toBe('MISSING_COLUMNS: Price');
    await http().post(`/imports/${noPrice.id}/approve`).set(auth(A.tokens.admin)).expect(409);

    const tooMany = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      await medsFile(
        Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => [
          `M${stamp}${i}`,
          'x',
          '',
          '',
          '',
        ]),
      ),
      'many.xlsx',
    );
    expect(tooMany).toMatchObject({ status: 'FAILED', errorMessage: 'TOO_MANY_ROWS' });

    const empty = await uploaded(A.tokens.admin, 'MEDICINES', await medsFile([]), 'empty.xlsx');
    expect(empty).toMatchObject({ status: 'PREVIEWED', totalRows: 0, validRows: 0 });
    await http()
      .post(`/imports/${empty.id}/approve`)
      .set(auth(A.tokens.admin))
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('IMPORT_NOTHING_TO_SAVE'));
    // headings in any order and with other spellings are found
    const shuffled = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      await xlsx([
        ['NAME', 'medicine code', 'Extra column'],
        ['Shuffled', uniq('SH'), 'ignored'],
      ]),
      'shuffled.xlsx',
    );
    expect(shuffled).toMatchObject({ status: 'PREVIEWED', validRows: 1 });
  });

  // ---------------------------------------------------------- cancel, twice, stale

  it('a batch can be cancelled before it is posted (nothing is saved), never after', async () => {
    const code = uniq('C');
    const file = await medsFile([[code, 'Never saved', '', '', '']]);
    const batch = await uploaded(A.tokens.admin, 'MEDICINES', file, 'cancel.xlsx');
    const cancelled = await http()
      .post(`/imports/${batch.id}/cancel`)
      .set(auth(A.tokens.admin))
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'FAILED', runStatus: 'CANCELLED' });
    expect(await owner.medicine.count({ where: { tenantId: A.tenant, code } })).toBe(0);
    // a cancelled batch can neither be approved nor cancelled again
    await http().post(`/imports/${batch.id}/approve`).set(auth(A.tokens.admin)).expect(409);
    await http().post(`/imports/${batch.id}/cancel`).set(auth(A.tokens.admin)).expect(409);
    // the same file may be uploaded again after a cancel
    const again = await uploaded(A.tokens.admin, 'MEDICINES', file, 'cancel.xlsx');
    expect(again.status).toBe('PREVIEWED');
    // cancel after approval is allowed too
    await http().post(`/imports/${again.id}/approve`).set(auth(A.tokens.admin)).expect(200);
    await http().post(`/imports/${again.id}/cancel`).set(auth(A.tokens.admin)).expect(200);
    await http().post(`/imports/${again.id}/post`).set(auth(A.tokens.admin)).expect(409);
    // after posting: final
    const third = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      await medsFile([[code, 'Saved now', '', '', '']]),
      'cancel3.xlsx',
    );
    await approveAndPost(A.tokens.admin, third.id);
    await http().post(`/imports/${third.id}/cancel`).set(auth(A.tokens.admin)).expect(409);
    expect(await owner.medicine.count({ where: { tenantId: A.tenant, code } })).toBe(1);
  });

  it('posting twice, or twice at the same moment, saves once', async () => {
    const doc = await makeDoctor(A, 'twice');
    const batch = await uploaded(
      A.tokens.admin,
      'DOCTOR_FEES',
      await feesFile([
        [doc.code, 'NEW', 500, ''],
        [doc.code, 'FOLLOW_UP', 300, ''],
      ]),
      'twice.xlsx',
    );
    await http().post(`/imports/${batch.id}/approve`).set(auth(A.tokens.admin)).expect(200);
    await http().post(`/imports/${batch.id}/approve`).set(auth(A.tokens.admin)).expect(409);
    later();
    const post = () => http().post(`/imports/${batch.id}/post`).set(auth(A.tokens.admin));
    const [a, b] = await Promise.all([post(), post()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await imports.idle();
    const done = await http().get(`/imports/${batch.id}`).set(auth(A.tokens.admin)).expect(200);
    expect(done.body).toMatchObject({ status: 'POSTED', runStatus: null });
    expect(await owner.doctorFee.count({ where: { doctorProfileId: doc.id } })).toBe(2);
    // and once more after it is posted
    await post().expect(409);
    expect(await owner.doctorFee.count({ where: { doctorProfileId: doc.id } })).toBe(2);
  });

  it('if the data changed after the preview, nothing is saved; the batch stays approved and can be tried again', async () => {
    const fresh = uniq('S');
    const old = uniq('S');
    await owner.chargeItem
      .create({ data: { tenantId: A.tenant, code: old, name: 'Old test', kind: 'INVESTIGATION' } })
      .then((item) =>
        owner.chargeItemPrice.create({
          data: {
            tenantId: A.tenant,
            chargeItemId: item.id,
            amountPaise: 30_000,
            effectiveFrom: new Date('2020-01-01T00:00:00Z'),
            createdBy: A.adminId,
          },
        }),
      );
    const oldItem = await owner.chargeItem.findFirstOrThrow({
      where: { tenantId: A.tenant, code: old },
    });
    const batch = await uploaded(
      A.tokens.admin,
      'TESTS',
      await testsFile([
        [fresh, 'New test in a stale batch', 100, '', ''],
        [old, 'Old test', 99_999, '', ''],
      ]),
      'stale.xlsx',
    );
    expect(batch.exceptionRows).toBe(0);
    await http().post(`/imports/${batch.id}/approve`).set(auth(A.tokens.admin)).expect(200);
    // meanwhile somebody changes the price of TB from the Prices screen
    later();
    await http()
      .post(`/opd/prices/items/${oldItem.id}`)
      .set(auth(A.tokens.admin))
      .send({ amountPaise: 41_000 })
      .expect(200);
    await http().post(`/imports/${batch.id}/post`).set(auth(A.tokens.admin)).expect(202);
    await imports.idle();
    const failed = (await http().get(`/imports/${batch.id}`).set(auth(A.tokens.admin)).expect(200))
      .body;
    expect(failed).toMatchObject({ status: 'APPROVED', runStatus: 'POST_FAILED' });
    expect(failed.errorMessage).toBe('STALE:VERSION_EXISTS:3');
    // nothing of this batch was saved, not even the first (valid) row
    expect(await owner.chargeItem.count({ where: { tenantId: A.tenant, code: fresh } })).toBe(0);
    // a little later the same batch can be saved
    later();
    await http().post(`/imports/${batch.id}/post`).set(auth(A.tokens.admin)).expect(202);
    await imports.idle();
    expect((await http().get(`/imports/${batch.id}`).set(auth(A.tokens.admin))).body).toMatchObject(
      {
        status: 'POSTED',
        runStatus: null,
        errorMessage: null,
      },
    );
    expect(await owner.chargeItem.count({ where: { tenantId: A.tenant, code: fresh } })).toBe(1);
  });

  it('a late background run never overwrites a cancel', async () => {
    const batch = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      await medsFile([[uniq('L'), 'Late', '', '', '']]),
      'late.xlsx',
    );
    await http().post(`/imports/${batch.id}/approve`).set(auth(A.tokens.admin)).expect(200);
    await http().post(`/imports/${batch.id}/cancel`).set(auth(A.tokens.admin)).expect(200);
    // a post run that was already going records its failure after the cancel
    const actor = { tenantId: A.tenant, userId: A.adminId, branchId: A.main };
    await (
      imports as unknown as {
        recordPostFailure: (a: typeof actor, id: string, e: unknown) => Promise<void>;
      }
    ).recordPostFailure(actor, batch.id, new Error('late'));
    const body = (await http().get(`/imports/${batch.id}`).set(auth(A.tokens.admin))).body;
    expect(body).toMatchObject({ status: 'FAILED', runStatus: 'CANCELLED' });
  });

  it('a file that no longer matches what was approved is never saved', async () => {
    const code = uniq('K');
    const batch = await uploaded(
      A.tokens.admin,
      'MEDICINES',
      await medsFile([[code, 'Tampered', '', '', '']]),
      'tamper.xlsx',
    );
    await http().post(`/imports/${batch.id}/approve`).set(auth(A.tokens.admin)).expect(200);
    await owner.$executeRawUnsafe(
      `UPDATE import_batches SET file_sha256 = repeat('0', 64) WHERE id = $1`,
      batch.id,
    );
    await http().post(`/imports/${batch.id}/post`).set(auth(A.tokens.admin)).expect(202);
    await imports.idle();
    const body = (await http().get(`/imports/${batch.id}`).set(auth(A.tokens.admin))).body;
    expect(body).toMatchObject({
      status: 'APPROVED',
      runStatus: 'POST_FAILED',
      errorMessage: 'STALE:FILE_CHANGED',
    });
    expect(await owner.medicine.count({ where: { tenantId: A.tenant, code } })).toBe(0);
  });

  // ------------------------------------------------------------------- hospitals apart

  it('another hospital can neither see nor touch a batch, and its own identical file is not a duplicate', async () => {
    const code = uniq('I');
    const file = await medsFile([[code, 'Hospital A medicine', '', '', '']]);
    const batch = await uploaded(A.tokens.admin, 'MEDICINES', file, 'iso.xlsx');
    for (const call of [
      () => http().get(`/imports/${batch.id}`),
      () => http().get(`/imports/${batch.id}/rows`),
      () => http().post(`/imports/${batch.id}/approve`),
      () => http().post(`/imports/${batch.id}/post`),
      () => http().post(`/imports/${batch.id}/cancel`),
    ]) {
      await call().set(auth(B.tokens.admin)).expect(404);
    }
    const listB = await http().get('/imports?pageSize=100').set(auth(B.tokens.admin)).expect(200);
    expect((listB.body.items as Array<{ id: string }>).some((i) => i.id === batch.id)).toBe(false);
    const mine = await uploaded(B.tokens.admin, 'MEDICINES', file, 'iso.xlsx');
    expect(mine.status).toBe('PREVIEWED');
    await approveAndPost(B.tokens.admin, mine.id);
    // hospital A's batch is untouched, and hospital A got no medicine from B's batch
    expect((await http().get(`/imports/${batch.id}`).set(auth(A.tokens.admin))).body.status).toBe(
      'PREVIEWED',
    );
    expect(await owner.medicine.count({ where: { tenantId: A.tenant, code } })).toBe(0);
    expect(await owner.medicine.count({ where: { tenantId: B.tenant, code } })).toBe(1);
    await http().post(`/imports/${batch.id}/cancel`).set(auth(A.tokens.admin)).expect(200);
  });

  it('rejects ids that are not ids and unknown batches calmly', async () => {
    await http().get('/imports/bad%20id!').set(auth(A.tokens.admin)).expect(400);
    await http().get('/imports/no_such_batch').set(auth(A.tokens.admin)).expect(404);
    await http()
      .get('/imports/no_such_batch/rows?status=NOPE')
      .set(auth(A.tokens.admin))
      .expect(400);
    await send(A.tokens.admin, 'NOPE', await medsFile([['a', 'b', '', '', '']])).expect(404);
  });

  it('the batch list is paged, newest first, and shows who uploaded', async () => {
    const res = await http().get('/imports?pageSize=2').set(auth(A.tokens.admin)).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBeGreaterThan(2);
    expect(res.body.items[0].createdByName).toBe('First SuperAdmin');
    const t0 = new Date(res.body.items[0].createdAt).getTime();
    const t1 = new Date(res.body.items[1].createdAt).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1);
  });
});
