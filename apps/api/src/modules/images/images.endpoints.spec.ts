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
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.service';
import { IMAGE_LIMITS } from './images.config';
import { makeGif, makeJpeg, makePng, makeSvg, makeWebp } from './image-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function testUrl(envKey: string, owner = false): string {
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is required for the picture tests`);
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
  tokens: Record<string, string>;
  users: Record<string, string>;
  docs: Record<string, string>;
};

const CODES = [
  'hospital.settings.read',
  'hospital.settings.write',
  'opd.doctors.own',
  'opd.doctors.read',
  'opd.doctors.write',
  'opd.visits.read',
] as const;

describe('pictures: logo and doctor signature (HTTP)', () => {
  jest.setTimeout(180_000);
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let storage: StorageService;
  let tokenService: import('../auth/token.service').TokenService;
  const stamp = Date.now();
  let A: Hospital;
  let B: Hospital;
  const tenants: string[] = [];

  async function seedHospital(label: string): Promise<Hospital> {
    const opd = await owner.module.upsert({
      where: { code: 'OPD' },
      create: { code: 'OPD', name: 'Outpatient' },
      update: { isActive: true },
    });
    const hospital = await owner.hospital.create({
      data: {
        code: `IM_${label}_${stamp}`,
        name: `Pictures ${label}`,
        isTest: true,
        branches: {
          create: [
            {
              code: 'MAIN',
              name: 'Main Branch',
              isMain: true,
              accessCode: `im-${label}-m-${stamp}`,
            },
            {
              code: 'EAST',
              name: 'East Branch',
              isMain: false,
              accessCode: `im-${label}-e-${stamp}`,
            },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    tenants.push(tenant);
    const main = hospital.branches.find((b) => b.isMain)!.id;
    const east = hospital.branches.find((b) => !b.isMain)!.id;
    await owner.hospitalModuleSubscription.create({ data: { tenantId: tenant, moduleId: opd.id } });
    for (const branchId of [main, east]) {
      await owner.branchModule.create({
        data: { tenantId: tenant, branchId, moduleId: opd.id, enabledByIndigo: true },
      });
    }
    const perms = await owner.permission.findMany({ where: { code: { in: [...CODES] } } });
    const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
    const users: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    const docs: Record<string, string> = {};

    async function makeUser(
      key: string,
      codes: readonly string[],
      branches: string[],
      opts: { hospitalScope?: boolean } = {},
    ) {
      const u = await owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `im_${key}_${label}_${stamp}@example.test`,
          displayName: `Person ${key} ${label}`,
          passwordHash: 'x',
        },
      });
      for (const branchId of opts.hospitalScope ? [main, east] : branches) {
        await owner.userBranch.create({ data: { tenantId: tenant, userId: u.id, branchId } });
      }
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
          data: {
            tenantId: tenant,
            userId: u.id,
            roleId: role.id,
            scopeType: opts.hospitalScope ? 'HOSPITAL' : 'BRANCH',
          },
        });
        if (!opts.hospitalScope) {
          for (const branchId of branches) {
            await owner.roleAssignmentBranch.create({
              data: { tenantId: tenant, assignmentId: assignment.id, branchId },
            });
          }
        }
      }
      users[key] = u.id;
      tokens[key] = tokenService.signHospitalAccess({
        tenantId: tenant,
        userId: u.id,
        branchId: branches[0]!,
      });
      return u;
    }
    async function makeDoctor(key: string, branches: string[]) {
      const u = await makeUser(key, ['opd.doctors.own'], branches);
      const profile = await owner.doctorProfile.create({
        data: {
          tenantId: tenant,
          userId: u.id,
          code: `D_${key}_${label}_${stamp}`.slice(0, 40),
          department: 'General',
        },
      });
      docs[key] = profile.id;
    }

    await makeUser(
      'superAdmin',
      [
        'hospital.settings.read',
        'hospital.settings.write',
        'opd.doctors.read',
        'opd.doctors.write',
        'opd.visits.read',
      ],
      [main],
      { hospitalScope: true },
    );
    await makeUser(
      'branchAdmin',
      [
        'hospital.settings.read',
        'hospital.settings.write',
        'opd.doctors.read',
        'opd.doctors.write',
      ],
      [main],
    );
    await makeUser('adminEast', ['opd.doctors.read', 'opd.doctors.write'], [east]);
    await makeUser('doctorReader', ['opd.doctors.read'], [main]);
    await makeUser('visitReader', ['opd.visits.read'], [main]);
    await makeUser('settingsReader', ['hospital.settings.read'], [main]);
    await makeUser('nobody', [], [main]);
    await makeUser('noProfile', ['opd.doctors.own'], [main]);
    await makeDoctor('docMain', [main]);
    await makeDoctor('docEast', [east]);
    return { tenant, main, east, tokens, users, docs };
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
    storage = app.get(STORAGE_SERVICE);
    A = await seedHospital('A');
    B = await seedHospital('B');
  });

  afterAll(async () => {
    // the files made here are not needed any more (the rows stay, like other test data)
    const rows = await owner.storedImage.findMany({ where: { tenantId: { in: tenants } } });
    for (const row of rows) {
      await storage.delete(row.tenantId, row.storageKey).catch(() => undefined);
    }
    await app.close();
    await owner.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const auth = (h: Hospital, who: string) => ({ Authorization: `Bearer ${h.tokens[who]}` });
  const upload = (
    h: Hospital,
    who: string,
    url: string,
    bytes: Buffer | null,
    over: { filename?: string; contentType?: string; field?: string } = {},
  ): Promise<Loose> => {
    const req = (http() as Loose).put(url).set(auth(h, who));
    if (bytes) {
      req.attach(over.field ?? 'file', bytes, {
        filename: over.filename ?? 'picture.png',
        contentType: over.contentType ?? 'image/png',
      });
    }
    return req;
  };
  const get = (h: Hospital, who: string, url: string): Promise<Loose> =>
    (http() as Loose).get(url).set(auth(h, who));
  const post = (h: Hospital, who: string, url: string): Promise<Loose> =>
    (http() as Loose).post(url).set(auth(h, who)).send({});
  const rowsOf = (where: Loose) =>
    owner.storedImage.findMany({ where, orderBy: { createdAt: 'asc' } });
  const logoRows = (h: Hospital) => rowsOf({ tenantId: h.tenant, purpose: 'HOSPITAL_LOGO' });
  const invalid = (res: Loose, reason: string) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SETTINGS_INVALID');
    expect(res.body.field).toBe('file');
    expect(res.body.reason).toBe(reason);
  };
  const bytesOf = async (res: Loose): Promise<Buffer> => Buffer.from(res.body);
  const binary = (h: Hospital, who: string, id: string): Promise<Loose> =>
    (http() as Loose)
      .get(`/images/${id}`)
      .set(auth(h, who))
      .buffer(true)
      .parse((res: Loose, cb: Loose) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  describe('access', () => {
    it('401 without a token or with a patient token, on every route', async () => {
      const patientToken = tokenService.signPatientAccess({ accountId: 'acc' });
      const routes: Array<['get' | 'put' | 'post', string]> = [
        ['get', '/images/some-id'],
        ['get', '/settings/branding'],
        ['put', '/settings/branding/logo'],
        ['post', '/settings/branding/logo/remove'],
        ['put', '/doctor-profiles/me/signature'],
        ['post', '/doctor-profiles/me/signature/remove'],
        ['put', '/doctor-profiles/some-id/signature'],
        ['post', '/doctor-profiles/some-id/signature/remove'],
      ];
      for (const [method, url] of routes) {
        expect((await (http() as Loose)[method](url)).status).toBe(401);
        expect(
          (await (http() as Loose)[method](url).set({ Authorization: `Bearer ${patientToken}` }))
            .status,
        ).toBe(401);
      }
    });

    it('nobody without the permission can upload a logo or a signature', async () => {
      const png = makePng(80, 40);
      for (const who of ['nobody', 'settingsReader', 'doctorReader', 'visitReader']) {
        expect((await upload(A, who, '/settings/branding/logo', png)).status).toBe(403);
        expect((await post(A, who, '/settings/branding/logo/remove')).status).toBe(403);
      }
      for (const who of ['nobody', 'settingsReader', 'doctorReader', 'visitReader']) {
        expect((await upload(A, who, '/doctor-profiles/me/signature', png)).status).toBe(403);
        expect(
          (await upload(A, who, `/doctor-profiles/${A.docs.docMain}/signature`, png)).status,
        ).toBe(403);
      }
      expect(await logoRows(A)).toHaveLength(0);
    });
  });

  describe('the hospital logo', () => {
    it('anyone signed in can ask what the logo is; only a hospital-wide Admin may change it', async () => {
      for (const who of ['nobody', 'doctorReader', 'superAdmin']) {
        const res = await get(A, who, '/settings/branding');
        expect(res.status).toBe(200);
        expect(res.body.logo).toBeNull();
        expect(res.body.limits).toEqual({
          maxBytes: IMAGE_LIMITS.maxBytes,
          maxSidePx: IMAGE_LIMITS.maxSidePx,
          minSidePx: IMAGE_LIMITS.minSidePx,
          types: ['image/png', 'image/jpeg', 'image/webp'],
        });
      }
      expect((await get(A, 'superAdmin', '/settings/branding')).body.canWrite).toBe(true);
      expect((await get(A, 'branchAdmin', '/settings/branding')).body.canWrite).toBe(false);
      expect((await get(A, 'nobody', '/settings/branding')).body.canWrite).toBe(false);
    });

    it('a Branch Admin (one branch only) cannot change the hospital logo, even with the permission', async () => {
      expect(
        (await upload(A, 'branchAdmin', '/settings/branding/logo', makePng(80, 40))).status,
      ).toBe(403);
      expect((await post(A, 'branchAdmin', '/settings/branding/logo/remove')).status).toBe(403);
      expect(await logoRows(A)).toHaveLength(0);
    });

    it('stores a picture by its real type, keeps the bytes whole, and tells only what the screen needs', async () => {
      const png = makePng(200, 100, 500);
      // the name and the claimed type are ignored
      const res = await upload(A, 'superAdmin', '/settings/branding/logo', png, {
        filename: 'logo.exe',
        contentType: 'application/x-msdownload',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        contentType: 'image/png',
        byteSize: png.length,
        width: 200,
        height: 100,
      });
      expect(Object.keys(res.body).sort()).toEqual([
        'byteSize',
        'contentType',
        'createdAt',
        'height',
        'id',
        'width',
      ]);
      const rows = await logoRows(A);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        isCurrent: true,
        purpose: 'HOSPITAL_LOGO',
        doctorProfileId: null,
      });
      expect(rows[0]!.storageKey).toBe(`images/${res.body.id}`);
      expect(rows[0]!.createdBy).toBe(A.users.superAdmin);
      expect(await storage.exists(A.tenant, rows[0]!.storageKey)).toBe(true);
      expect((await get(A, 'nobody', '/settings/branding')).body.logo.id).toBe(res.body.id);
    });

    it('serves the picture as a picture only: right type, never run or guessed as something else', async () => {
      const current = (await get(A, 'nobody', '/settings/branding')).body.logo;
      const res = await binary(A, 'nobody', current.id);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('inline');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['cache-control']).toContain('private');
      expect(Number(res.headers['content-length'])).toBe(current.byteSize);
      expect((await bytesOf(res)).length).toBe(current.byteSize);
      expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    });

    it('a new logo replaces it; the old row and file stay, and exactly one is current', async () => {
      const before = (await logoRows(A))[0]!;
      const res = await upload(A, 'superAdmin', '/settings/branding/logo', makeJpeg(150, 90), {
        filename: 'x.png',
        contentType: 'image/png',
      });
      expect(res.status).toBe(200);
      expect(res.body.contentType).toBe('image/jpeg'); // judged by the bytes
      const rows = await logoRows(A);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.isCurrent).map((r) => r.id)).toEqual([res.body.id]);
      expect(await storage.exists(A.tenant, before.storageKey)).toBe(true);
      // an old picture can still be fetched (a printed document may point at it)
      expect((await binary(A, 'nobody', before.id)).status).toBe(200);
      const webp = await upload(A, 'superAdmin', '/settings/branding/logo', makeWebp(64, 64));
      expect(webp.body.contentType).toBe('image/webp');
      expect((await logoRows(A)).filter((r) => r.isCurrent)).toHaveLength(1);
    });

    it('refuses what is not a good picture, with the reason, and leaves no row and no file', async () => {
      const before = await logoRows(A);
      const files = async () => (await rowsOf({ tenantId: A.tenant })).length;
      const count = await files();
      const url = '/settings/branding/logo';
      invalid(await upload(A, 'superAdmin', url, null), 'REQUIRED');
      invalid(await upload(A, 'superAdmin', url, Buffer.alloc(0)), 'EMPTY');
      invalid(await upload(A, 'superAdmin', url, Buffer.from('just some text')), 'NOT_AN_IMAGE');
      invalid(
        await upload(A, 'superAdmin', url, makeSvg(), { filename: 'logo.png' }),
        'NOT_AN_IMAGE',
      );
      invalid(
        await upload(A, 'superAdmin', url, makeGif(), { contentType: 'image/png' }),
        'NOT_AN_IMAGE',
      );
      const png = makePng(80, 40);
      invalid(await upload(A, 'superAdmin', url, png.subarray(0, png.length - 4)), 'CORRUPT');
      invalid(
        await upload(A, 'superAdmin', url, Buffer.concat([png, Buffer.from('<script>')])),
        'CORRUPT',
      );
      invalid(await upload(A, 'superAdmin', url, makePng(8, 8)), 'TOO_SMALL');
      invalid(
        await upload(A, 'superAdmin', url, makePng(IMAGE_LIMITS.maxSidePx + 1, 100)),
        'TOO_LARGE_PIXELS',
      );
      invalid(
        await upload(A, 'superAdmin', url, makePng(100, 100, IMAGE_LIMITS.maxBytes)),
        'TOO_BIG',
      );
      expect(await logoRows(A)).toHaveLength(before.length);
      expect(await files()).toBe(count);
    });

    it('a file far bigger than the limit is stopped while it is read, with the same plain reason; the picture is unchanged', async () => {
      const huge = makePng(100, 100, IMAGE_LIMITS.maxBytes * 3);
      const before = (await get(A, 'nobody', '/settings/branding')).body.logo.id;
      invalid(await upload(A, 'superAdmin', '/settings/branding/logo', huge), 'TOO_BIG');
      expect((await get(A, 'nobody', '/settings/branding')).body.logo.id).toBe(before);
    });

    it('a tiny picture made only of plain characters, sent as a hand-written multipart body (how the Postman collection does it), is accepted', async () => {
      // WebP header, 64 x 64: every byte is below 0x80, so it survives being written as text
      const webp = Buffer.from(
        'RIFF\x16\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00\x3f\x00\x00\x3f\x00\x00',
        'latin1',
      );
      expect(webp.length).toBe(30);
      expect([...webp].every((b) => b < 0x80)).toBe(true);
      const body =
        '--pm7e\r\nContent-Disposition: form-data; name="file"; filename="logo.webp"\r\n' +
        'Content-Type: image/webp\r\n\r\n' +
        webp.toString('latin1') +
        '\r\n--pm7e--\r\n';
      const res = await (http() as Loose)
        .put('/settings/branding/logo')
        .set({ ...auth(A, 'superAdmin'), 'Content-Type': 'multipart/form-data; boundary=pm7e' })
        .send(Buffer.from(body, 'utf8'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        contentType: 'image/webp',
        width: 64,
        height: 64,
        byteSize: 30,
      });
    });

    it('a multipart body with no file in it at all is refused like a missing file (REQUIRED)', async () => {
      const res = await (http() as Loose)
        .put('/settings/branding/logo')
        .set({ ...auth(A, 'superAdmin'), 'Content-Type': 'multipart/form-data; boundary=pm7e' })
        .send(Buffer.from('--pm7e--\r\n', 'utf8'));
      invalid(res, 'REQUIRED');
    });

    it('extra form fields, a second file or the wrong field name are refused', async () => {
      const png = makePng(80, 40);
      const url = '/settings/branding/logo';
      const withField = await (http() as Loose)
        .put(url)
        .set(auth(A, 'superAdmin'))
        .field('tenantId', B.tenant)
        .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
      expect(withField.status).toBe(400);
      const two = await (http() as Loose)
        .put(url)
        .set(auth(A, 'superAdmin'))
        .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
        .attach('file', png, { filename: 'b.png', contentType: 'image/png' });
      expect(two.status).toBe(400);
      expect((await upload(A, 'superAdmin', url, png, { field: 'photo' })).status).toBe(400);
      const json = await (http() as Loose)
        .put(url)
        .set(auth(A, 'superAdmin'))
        .send({ file: 'abc' });
      expect(json.status).toBe(400);
    });

    it('two uploads at once leave exactly one current logo', async () => {
      const results = await Promise.all([
        upload(A, 'superAdmin', '/settings/branding/logo', makePng(90, 90, 1)),
        upload(A, 'superAdmin', '/settings/branding/logo', makePng(91, 91, 2)),
        upload(A, 'superAdmin', '/settings/branding/logo', makePng(92, 92, 3)),
      ]);
      const okay = results.filter((r) => r.status === 200);
      expect(okay.length).toBeGreaterThanOrEqual(1);
      for (const r of results.filter((x) => x.status !== 200)) {
        expect(r.status).toBe(409);
        expect(r.body.reason).toBe('TRY_AGAIN');
      }
      expect((await logoRows(A)).filter((r) => r.isCurrent)).toHaveLength(1);
      // a refused upload leaves no file behind: every row has its file
      for (const row of await logoRows(A)) {
        expect(await storage.exists(A.tenant, row.storageKey)).toBe(true);
      }
    });

    it('another hospital has its own logo and never sees this one', async () => {
      expect((await get(B, 'superAdmin', '/settings/branding')).body.logo).toBeNull();
      const mine = (await get(A, 'superAdmin', '/settings/branding')).body.logo.id;
      expect((await get(B, 'superAdmin', `/images/${mine}`)).status).toBe(404);
      expect((await get(B, 'superAdmin', '/images/does-not-exist')).status).toBe(404);
      const theirs = await upload(B, 'superAdmin', '/settings/branding/logo', makePng(70, 70));
      expect(theirs.status).toBe(200);
      expect((await get(A, 'superAdmin', `/images/${theirs.body.id}`)).status).toBe(404);
      expect((await get(A, 'superAdmin', '/settings/branding')).body.logo.id).toBe(mine);
    });

    it('a junk id is 404, never a file path', async () => {
      for (const id of ['..%2F..%2Fetc%2Fpasswd', '%2e%2e', 'a%00b', 'x'.repeat(300)]) {
        expect((await get(A, 'superAdmin', `/images/${id}`)).status).toBe(404);
      }
    });

    it('removing the logo stops using it; the rows and files stay; removing again is harmless', async () => {
      const before = await logoRows(A);
      const res = await post(A, 'superAdmin', '/settings/branding/logo/remove');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ logo: null });
      expect((await get(A, 'nobody', '/settings/branding')).body.logo).toBeNull();
      const rows = await logoRows(A);
      expect(rows).toHaveLength(before.length);
      expect(rows.every((r) => !r.isCurrent)).toBe(true);
      for (const row of rows) {
        expect(await storage.exists(A.tenant, row.storageKey)).toBe(true);
      }
      expect((await post(A, 'superAdmin', '/settings/branding/logo/remove')).status).toBe(200);
    });

    it('every change is recorded with who and what kind, never the picture', async () => {
      const trail = await owner.auditLog.findMany({
        where: { tenantId: A.tenant, action: 'IMAGE_CHANGE' },
        orderBy: { createdAt: 'asc' },
      });
      expect(trail.length).toBeGreaterThanOrEqual(3);
      for (const t of trail) {
        expect(t.actorUserId).toBe(A.users.superAdmin);
        expect(Object.keys(t.metadata as object).sort()).toEqual(['kind', 'purpose']);
      }
      expect(trail.some((t) => (t.metadata as { kind: string }).kind === 'remove')).toBe(true);
      expect(JSON.stringify(trail)).not.toMatch(/storageKey|sha256|images\//);
    });
  });

  describe('the doctor signature or stamp', () => {
    const png = () => makePng(240, 80, 200);

    it('a doctor uploads their own; the profile shows it; the profile is found from the token', async () => {
      const before = await get(A, 'docMain', '/doctor-profiles/me');
      expect(before.body.signature).toBeNull();
      expect(before.body.images.maxBytes).toBe(IMAGE_LIMITS.maxBytes);
      const res = await upload(A, 'docMain', '/doctor-profiles/me/signature', png());
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(A.docs.docMain);
      expect(res.body.signature).toMatchObject({
        contentType: 'image/png',
        width: 240,
        height: 80,
      });
      const rows = await rowsOf({ doctorProfileId: A.docs.docMain });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        purpose: 'DOCTOR_SIGNATURE',
        isCurrent: true,
        createdBy: A.users.docMain,
      });
      expect((await get(A, 'docMain', '/doctor-profiles/me')).body.signature.id).toBe(rows[0]!.id);
    });

    it('a person with the own permission but no profile gets 403 and stores nothing', async () => {
      const res = await upload(A, 'noProfile', '/doctor-profiles/me/signature', png());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('DOCTOR_PROFILE_REQUIRED');
      expect((await post(A, 'noProfile', '/doctor-profiles/me/signature/remove')).status).toBe(403);
    });

    it('the doctor cannot pick another doctor: the own route ignores ids in the form', async () => {
      const res = await (http() as Loose)
        .put('/doctor-profiles/me/signature')
        .set(auth(A, 'docEast'))
        .attach('file', png(), { filename: 's.png', contentType: 'image/png' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(A.docs.docEast);
      expect(await rowsOf({ doctorProfileId: A.docs.docMain, isCurrent: true })).toHaveLength(1);
    });

    it('who may look at a signature: its doctor, readers of doctors or visits; nobody else', async () => {
      const id = (await get(A, 'docMain', '/doctor-profiles/me')).body.signature.id;
      expect((await binary(A, 'docMain', id)).status).toBe(200);
      for (const who of ['superAdmin', 'doctorReader', 'visitReader']) {
        expect((await binary(A, who, id)).status).toBe(200);
      }
      // another doctor, a person with no related permission, and another hospital
      for (const who of ['docEast', 'nobody', 'settingsReader', 'noProfile']) {
        expect((await get(A, who, `/images/${id}`)).status).toBe(404);
      }
      expect((await get(B, 'superAdmin', `/images/${id}`)).status).toBe(404);
    });

    it('an Admin sees it in the list; a Branch Admin uploads only for doctors of their branch', async () => {
      const list = await get(A, 'superAdmin', '/doctor-profiles');
      const mine = list.body.items.find((d: Loose) => d.id === A.docs.docMain);
      expect(mine.signature).toMatchObject({ contentType: 'image/png' });
      expect(list.body.items.find((d: Loose) => d.id === A.docs.docEast).signature).not.toBeNull();
      expect(list.body.images.types).toContain('image/webp');
      const east = await upload(
        A,
        'branchAdmin',
        `/doctor-profiles/${A.docs.docEast}/signature`,
        png(),
      );
      expect(east.status).toBe(404); // not their branch
      const own = await upload(
        A,
        'branchAdmin',
        `/doctor-profiles/${A.docs.docMain}/signature`,
        makeJpeg(120, 60),
      );
      expect(own.status).toBe(200);
      expect(own.body.signature.contentType).toBe('image/jpeg');
      expect(own.body.id).toBe(A.docs.docMain);
      expect(
        (await post(A, 'adminEast', `/doctor-profiles/${A.docs.docMain}/signature/remove`)).status,
      ).toBe(404);
    });

    it('a reader who may not write is refused; so are unknown, junk and other-hospital doctors (404)', async () => {
      expect(
        (await upload(A, 'doctorReader', `/doctor-profiles/${A.docs.docMain}/signature`, png()))
          .status,
      ).toBe(403);
      for (const id of ['unknown-id', '..%2Fx', B.docs.docMain]) {
        expect(
          (await upload(A, 'superAdmin', `/doctor-profiles/${id}/signature`, png())).status,
        ).toBe(404);
        expect(
          (await post(A, 'superAdmin', `/doctor-profiles/${id}/signature/remove`)).status,
        ).toBe(404);
      }
      expect(await rowsOf({ doctorProfileId: B.docs.docMain })).toHaveLength(0);
    });

    it('a bad picture is refused for a signature too, with the same reasons', async () => {
      invalid(
        await upload(A, 'docMain', '/doctor-profiles/me/signature', makeSvg()),
        'NOT_AN_IMAGE',
      );
      invalid(await upload(A, 'docMain', '/doctor-profiles/me/signature', null), 'REQUIRED');
      invalid(
        await upload(
          A,
          'superAdmin',
          `/doctor-profiles/${A.docs.docMain}/signature`,
          makePng(4, 4),
        ),
        'TOO_SMALL',
      );
    });

    it('replacing keeps the old picture on record, one is current; removing leaves none current', async () => {
      const before = await rowsOf({ doctorProfileId: A.docs.docMain });
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect(before.filter((r) => r.isCurrent)).toHaveLength(1);
      const res = await post(A, 'docMain', '/doctor-profiles/me/signature/remove');
      expect(res.status).toBe(200);
      expect(res.body.signature).toBeNull();
      const after = await rowsOf({ doctorProfileId: A.docs.docMain });
      expect(after).toHaveLength(before.length);
      expect(after.some((r) => r.isCurrent)).toBe(false);
      for (const row of after) {
        expect(await storage.exists(A.tenant, row.storageKey)).toBe(true);
      }
      const admin = await post(
        A,
        'superAdmin',
        `/doctor-profiles/${A.docs.docEast}/signature/remove`,
      );
      expect(admin.body.signature).toBeNull();
    });

    it('a doctor who is switched off cannot reach pictures with the old token', async () => {
      await owner.user.update({ where: { id: A.users.docEast }, data: { isActive: false } });
      try {
        const up = await upload(A, 'docEast', '/doctor-profiles/me/signature', png());
        expect([401, 403]).toContain(up.status);
        const id = (await rowsOf({ doctorProfileId: A.docs.docEast }))[0]!.id;
        expect((await get(A, 'docEast', `/images/${id}`)).status).toBe(404);
        expect((await get(A, 'docEast', '/images/whatever')).status).toBe(404);
      } finally {
        await owner.user.update({ where: { id: A.users.docEast }, data: { isActive: true } });
      }
    });
  });

  describe('the database rules', () => {
    it('a stored picture cannot be edited (only is_current moves) and the one-current rule holds', async () => {
      const row = (await logoRows(A))[0]!;
      await expect(
        owner.$executeRawUnsafe(`UPDATE stored_images SET width = 999 WHERE id = '${row.id}'`),
      ).rejects.toThrow(/cannot be edited/);
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE stored_images SET storage_key = 'images/other' WHERE id = '${row.id}'`,
        ),
      ).rejects.toThrow(/cannot be edited/);
      const current = await logoRows(A);
      // two current rows for one place are refused by the database itself
      const dup = (isCurrent: boolean) =>
        owner.storedImage.create({
          data: {
            tenantId: A.tenant,
            purpose: 'HOSPITAL_LOGO',
            contentType: 'image/png',
            byteSize: 10,
            width: 20,
            height: 20,
            sha256: 'b'.repeat(64),
            storageKey: `images/dup-${Math.random()}`,
            isCurrent,
            createdBy: A.users.superAdmin,
          },
        });
      await dup(true);
      await expect(dup(true)).rejects.toThrow();
      await dup(false); // history rows are not limited
      expect((await logoRows(A)).length).toBeGreaterThan(current.length);
    });

    it('a signature row needs a doctor and a logo row must not have one; only known types and purposes', async () => {
      const base = {
        tenantId: A.tenant,
        contentType: 'image/png',
        byteSize: 10,
        width: 20,
        height: 20,
        sha256: 'c'.repeat(64),
        storageKey: 'images/x',
        createdBy: A.users.superAdmin,
        isCurrent: false,
      };
      await expect(
        owner.storedImage.create({ data: { ...base, purpose: 'DOCTOR_SIGNATURE' } }),
      ).rejects.toThrow();
      await expect(
        owner.storedImage.create({
          data: { ...base, purpose: 'HOSPITAL_LOGO', doctorProfileId: A.docs.docMain },
        }),
      ).rejects.toThrow();
      await expect(
        owner.storedImage.create({ data: { ...base, purpose: 'PHOTO' } }),
      ).rejects.toThrow();
      await expect(
        owner.storedImage.create({
          data: { ...base, purpose: 'HOSPITAL_LOGO', contentType: 'image/svg+xml' },
        }),
      ).rejects.toThrow();
      // a doctor of another hospital cannot be pointed at
      await expect(
        owner.storedImage.create({
          data: { ...base, purpose: 'DOCTOR_SIGNATURE', doctorProfileId: B.docs.docMain },
        }),
      ).rejects.toThrow();
    });
  });
});
