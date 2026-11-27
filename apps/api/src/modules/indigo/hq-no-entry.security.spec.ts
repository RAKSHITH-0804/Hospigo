import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma, createPgClient } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { AuthRedisService } from '../auth/auth-redis.service';
import type { TokenService } from '../auth/token.service';

prepareTestEnv();
process.env.AUTH_IP_RATE_LIMIT_PER_MIN = '1000';

/**
 * Phase 2.2, checkpoint 1, review gate: HQ never enters a hospital. The adversarial pass:
 * an HQ token on hospital routes, a hospital token on HQ routes, HQ Staff outside the hospitals
 * assigned to them, the removed routes, and the token of an old hidden Indigo user after the
 * migration that retires them.
 */
describe('HQ without entry (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const stamp = Date.now();
  let app: INestApplication;
  let tokens: TokenService;
  let A: KitHospital;
  let B: KitHospital;
  let hqAdmin: string;
  let hqStaff: string;
  let saA: string;
  let saB: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = (id: string) => tokens.signHqAccess({ userId: id });
  const makeHq = async (label: string, indigoRole: 'OWNER' | 'EMPLOYEE') =>
    (
      await owner.hqUser.create({
        data: {
          email: `noentry-${label}-${stamp}@example.test`,
          displayName: `No entry ${label}`,
          passwordHash: 'x',
          mustChangePassword: false,
          indigoRole,
        },
      })
    ).id;

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    tokens = booted.tokens;
    app.get(AuthRedisService).setKeyPrefix(`noentry-test-${stamp}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('NA');
    B = await kit.hospital('NB');
    const roleOf = (h: KitHospital) => ({ roleId: h.superAdminRoleId, scope: 'HOSPITAL' as const });
    saA = (await kit.person(A, 'sa', [A.main], roleOf(A))).token(A.main);
    saB = (await kit.person(B, 'sa', [B.main], roleOf(B))).token(B.main);
    hqAdmin = await makeHq('admin', 'OWNER');
    hqStaff = await makeHq('staff', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: hqStaff, tenantId: A.tenant } });
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  const HOSPITAL_GETS = [
    '/patients',
    '/opd/queue',
    '/staff',
    '/roles',
    '/dashboard/summary',
    '/print-templates',
    '/settings/branding',
    '/auth/switchable-branches',
    '/opd/refund-requests/pending-count',
  ];

  it('an HQ token (Admin or Staff) is refused on every hospital route', async () => {
    for (const id of [hqAdmin, hqStaff]) {
      for (const path of HOSPITAL_GETS) {
        const res = await http()
          .get(path)
          .set(auth(hq(id)));
        expect([path, res.status]).toEqual([path, 401]);
      }
      expect(
        (
          await http()
            .post('/auth/switch-branch')
            .set(auth(hq(id)))
            .send({ branchId: A.main })
        ).status,
      ).toBe(401);
    }
  });

  it('the entry routes no longer exist (404 for HQ Admin, HQ Staff, hospital staff and nobody)', async () => {
    const tokensToTry = [hq(hqAdmin), hq(hqStaff), saA];
    for (const token of tokensToTry) {
      expect(
        (await http().post('/auth/indigo/enter').set(auth(token)).send({ hospitalId: A.tenant }))
          .status,
      ).toBe(404);
      expect((await http().get('/auth/indigo/hospitals').set(auth(token))).status).toBe(404);
      expect((await http().get('/indigo-access-log').set(auth(token))).status).toBe(404);
    }
    expect((await http().post('/auth/indigo/enter').send({ hospitalId: A.tenant })).status).toBe(
      404,
    );
  });

  it('a hospital token is refused on every HQ console route', async () => {
    const routes: Array<['get' | 'post' | 'put', string]> = [
      ['get', '/indigo/hospitals'],
      ['get', '/indigo/employees'],
      ['get', '/indigo/library'],
      ['post', '/indigo/hospitals'],
      ['put', `/indigo/hospitals/${A.tenant}/modules`],
      ['put', `/indigo/hospitals/${A.tenant}/terminology`],
      ['post', `/indigo/hospitals/${A.tenant}/starter`],
    ];
    for (const [method, path] of routes) {
      const res = await http()[method](path).set(auth(saA)).send({});
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });

  it('HQ Staff outside the assigned hospitals: not listed, every console write or read is 403', async () => {
    const list = await http()
      .get('/indigo/hospitals')
      .set(auth(hq(hqStaff)))
      .expect(200);
    expect(list.body.items.map((h: { id: string }) => h.id)).toEqual([A.tenant]);
    expect(JSON.stringify(list.body)).not.toContain(B.tenant);
    for (const [method, path] of [
      ['put', `/indigo/hospitals/${B.tenant}/modules`],
      ['put', `/indigo/hospitals/${B.tenant}/terminology`],
      ['get', `/indigo/hospitals/${B.tenant}/terminology`],
      ['put', `/indigo/hospitals/${B.tenant}/library`],
      ['post', `/indigo/hospitals/${B.tenant}/starter`],
    ] as const) {
      const res = await http()
        [method](path)
        .set(auth(hq(hqStaff)))
        .send({});
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    // inside the assigned hospital HQ Staff may still not onboard, switch modules or manage people
    for (const [method, path] of [
      ['post', '/indigo/hospitals'],
      ['put', `/indigo/hospitals/${A.tenant}/modules`],
      ['get', '/indigo/employees'],
      ['post', '/indigo/employees'],
    ] as const) {
      const res = await http()
        [method](path)
        .set(auth(hq(hqStaff)))
        .send({});
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
  });

  it('switching HQ Staff off or removing the assignment empties the list at once', async () => {
    await owner.hqUser.update({ where: { id: hqStaff }, data: { isActive: false } });
    expect(
      (
        await http()
          .get('/indigo/hospitals')
          .set(auth(hq(hqStaff)))
          .expect(200)
      ).body.items,
    ).toEqual([]);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/terminology`)
          .set(auth(hq(hqStaff)))
          .send({})
      ).status,
    ).toBe(403);
    await owner.hqUser.update({ where: { id: hqStaff }, data: { isActive: true } });
    await owner.hqUserHospital.deleteMany({ where: { hqUserId: hqStaff, tenantId: A.tenant } });
    expect(
      (
        await http()
          .get('/indigo/hospitals')
          .set(auth(hq(hqStaff)))
          .expect(200)
      ).body.items,
    ).toEqual([]);
    await owner.hqUserHospital.create({ data: { hqUserId: hqStaff, tenantId: A.tenant } });
  });

  it("a hospital's Super Admin never sees the other hospital's data or any HQ person", async () => {
    const staffB = await http().get('/staff?pageSize=100').set(auth(saB)).expect(200);
    const text = JSON.stringify(staffB.body);
    expect(text).not.toContain('noentry-');
    expect(text).not.toContain('indigo.invalid');
    expect(text).not.toContain('indigo.example.org');
    const roles = await http().get('/roles').set(auth(saA)).expect(200);
    const codes = roles.body.items.map((r: { code: string }) => r.code);
    expect(codes).not.toContain('TENANT_ADMIN');
    expect(codes).not.toContain('INDIGO_EMPLOYEE');
    const me = await http().get('/auth/me').set(auth(saA)).expect(200);
    expect(me.body.permissions).not.toContain('indigo.access.read');
  });

  it('the HQ profile names the real HQ role', async () => {
    const admin = await http()
      .get('/auth/me')
      .set(auth(hq(hqAdmin)))
      .expect(200);
    expect(admin.body.roleCodes).toEqual(['HQ_ADMIN']);
    const staff = await http()
      .get('/auth/me')
      .set(auth(hq(hqStaff)))
      .expect(200);
    expect(staff.body.roleCodes).toEqual(['HQ_STAFF']);
  });

  it('an old hidden Indigo user is switched off by the migration: its token stops working', async () => {
    const kit = createKit(owner, tokens);
    const old = await kit.person(A, 'hidden', [A.main], {
      roleId: A.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    const token = old.token(A.main);
    await http().get('/staff').set(auth(token)).expect(200);
    // such a user is made here by switching the guard off for one statement (the retired entry made them)
    const client = createPgClient('owner');
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE users DISABLE TRIGGER users_indigo_flag_guard');
      await client.query('UPDATE users SET indigo_hq_user_id = $1 WHERE id = $2', [
        hqAdmin,
        old.id,
      ]);
      await client.query('ALTER TABLE users ENABLE TRIGGER users_indigo_flag_guard');
      await client.query('COMMIT');
      // nobody can set the flag on a user any more: the guard trigger refuses it without the old word
      await expect(
        client.query('UPDATE users SET indigo_hq_user_id = $1 WHERE id = $2', ['x', old.id]),
      ).rejects.toThrow();
      // run the migration that retires them (it is safe to run again)
      const sql = readFileSync(
        join(__dirname, '../../../prisma/migrations/20261129097000_remove_hq_entry/migration.sql'),
        'utf8',
      );
      await client.query(sql);
    } finally {
      await client.end();
    }
    const res = await http().get('/staff').set(auth(token));
    expect([401, 403]).toContain(res.status);
    const refreshed = await owner.user.findUniqueOrThrow({ where: { id: old.id } });
    expect(refreshed.isActive).toBe(false);
  });
});
