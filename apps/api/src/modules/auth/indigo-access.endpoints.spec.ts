import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma, createPgClient } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { AuthRedisService } from './auth-redis.service';
import type { TokenService } from './token.service';

prepareTestEnv();
// this spec signs people in many times within a minute
process.env.AUTH_IP_RATE_LIMIT_PER_MIN = '1000';

/**
 * Step 2.1b security checks of the Indigo entry: who may enter which hospital, what the hidden user
 * can and cannot do, what the hospital sees, and what stops working the moment Indigo switches a
 * person off. Everything runs on hospigo_test.
 */
describe('Indigo access (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const stamp = Date.now();
  let app: INestApplication;
  let tokens: TokenService;
  let A: KitHospital;
  let B: KitHospital;
  let saA: string; // hospital SuperAdmin of A
  let saB: string;
  let ownerId: string;
  let employeeId: string;
  let strangerEmployeeId: string;
  let ownerHq: string;
  let employeeHq: string;
  let strangerHq: string;
  let staffA: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hqToken = (userId: string) => tokens.signHqAccess({ userId });

  async function makeHq(label: string, indigoRole: 'OWNER' | 'EMPLOYEE'): Promise<string> {
    const row = await owner.hqUser.create({
      data: {
        email: `indigo-${label}-${stamp}@example.test`,
        displayName: `Indigo ${label}`,
        passwordHash: 'x',
        mustChangePassword: false,
        indigoRole,
      },
    });
    return row.id;
  }

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    tokens = booted.tokens;
    app.get(AuthRedisService).setKeyPrefix(`indigo-test-${stamp}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('IA');
    B = await kit.hospital('IB');
    const sa = await kit.person(A, 'sa', [A.main, A.east], {
      roleId: A.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    saA = sa.token(A.main);
    const saBPerson = await kit.person(B, 'sa', [B.main, B.east], {
      roleId: B.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    saB = saBPerson.token(B.main);
    staffA = (await kit.person(A, 'staff', [A.main])).id;
    ownerHq = await makeHq('owner', 'OWNER');
    employeeHq = await makeHq('employee', 'EMPLOYEE');
    strangerHq = await makeHq('stranger', 'EMPLOYEE');
    ownerId = ownerHq;
    employeeId = employeeHq;
    strangerEmployeeId = strangerHq;
    // the Employee works only in hospital A
    await owner.hqUserHospital.create({ data: { hqUserId: employeeHq, tenantId: A.tenant } });
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  function enter(hq: string, hospitalId: string) {
    return http()
      .post('/auth/indigo/enter')
      .set(auth(hqToken(hq)))
      .send({ hospitalId });
  }

  it('the Owner sees every active hospital, an Employee only the assigned ones', async () => {
    const all = await http()
      .get('/auth/indigo/hospitals')
      .set(auth(hqToken(ownerId)))
      .expect(200);
    const ids = all.body.items.map((h: { id: string }) => h.id);
    expect(ids).toEqual(expect.arrayContaining([A.tenant, B.tenant]));
    const mine = await http()
      .get('/auth/indigo/hospitals')
      .set(auth(hqToken(employeeId)))
      .expect(200);
    expect(mine.body.items.map((h: { id: string }) => h.id)).toEqual([A.tenant]);
    const none = await http()
      .get('/auth/indigo/hospitals')
      .set(auth(hqToken(strangerEmployeeId)))
      .expect(200);
    expect(none.body.items).toEqual([]);
  });

  it('the Owner enters a hospital and works with an ordinary hospital token as the Indigo Owner', async () => {
    const res = await enter(ownerId, A.tenant).expect(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    const me = await http().get('/auth/me').set(auth(res.body.accessToken)).expect(200);
    expect(me.body.kind).toBe('HOSPITAL');
    expect(me.body.displayName).toBe('Indigo owner (Indigo)');
    expect(me.body.roleCodes).toEqual(['TENANT_ADMIN']);
    expect(me.body.hospitalWide).toBe(true);
    expect(me.body.permissions).toEqual(
      expect.arrayContaining([
        'print.templates.manage',
        'opd.notes.amend',
        'patients.registry.read',
      ]),
    );
    // and the token is a hospital token: the HQ routes refuse it
    await http().get('/auth/indigo/hospitals').set(auth(res.body.accessToken)).expect(401);
  });

  it('the Employee has configuration power but no patient data, no templates, no Indigo log', async () => {
    const res = await enter(employeeId, A.tenant).expect(200);
    const me = await http().get('/auth/me').set(auth(res.body.accessToken)).expect(200);
    expect(me.body.roleCodes).toEqual(['INDIGO_EMPLOYEE']);
    const permissions: string[] = me.body.permissions;
    expect(permissions).toEqual(
      expect.arrayContaining(['user.write', 'role.write', 'opd.masters.write', 'opd.prices.write']),
    );
    for (const never of [
      'patients.registry.read',
      'patients.registry.write',
      'patients.history.view_all',
      'opd.visits.read',
      'opd.billing.read',
      'opd.notes.read',
      'opd.notes.amend',
      'opd.refunds.approve',
      'print.templates.manage',
      'indigo.access.read',
    ]) {
      expect(permissions).not.toContain(never);
    }
    // patient data is refused by the API itself, not hidden by a screen
    await http().get('/patients').set(auth(res.body.accessToken)).expect(403);
  });

  it('every refusal looks the same: unassigned hospital, unknown hospital, nonsense', async () => {
    const unassigned = await enter(employeeId, B.tenant);
    const unknown = await enter(employeeId, 'does-not-exist');
    const stranger = await enter(strangerEmployeeId, A.tenant);
    for (const res of [unassigned, unknown, stranger]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual(unassigned.body);
    }
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hqToken(ownerId)))
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hqToken(ownerId)))
          .send({ hospitalId: 'x', tenantId: A.tenant })
      ).status,
    ).toBe(400);
  });

  it('only an Indigo (HQ) token may enter: hospital, patient and missing tokens are refused', async () => {
    expect((await http().post('/auth/indigo/enter').send({ hospitalId: A.tenant })).status).toBe(
      401,
    );
    expect(
      (await http().post('/auth/indigo/enter').set(auth(saA)).send({ hospitalId: A.tenant }))
        .status,
    ).toBe(401);
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set({ Authorization: 'Bearer not.a.token' })
          .send({ hospitalId: A.tenant })
      ).status,
    ).toBe(401);
  });

  it('the hidden Indigo user is never listed, counted, opened, changed, or given to staff', async () => {
    await enter(ownerId, A.tenant).expect(200);
    const list = await http().get('/staff?pageSize=100').set(auth(saA)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('(Indigo)');
    expect(JSON.stringify(list.body)).not.toContain('indigo.invalid');
    const flagged = await owner.user.findFirstOrThrow({
      where: { tenantId: A.tenant, indigoHqUserId: ownerId },
    });
    // a hospital SuperAdmin cannot change, switch off or re-send to it: it simply does not exist for them
    expect(
      (await http().put(`/staff/${flagged.id}`).set(auth(saA)).send({ name: 'Renamed' })).status,
    ).toBe(404);
    expect((await http().post(`/staff/${flagged.id}/deactivate`).set(auth(saA))).status).toBe(404);
    // the Indigo roles do not appear in the role lists
    const roles = await http().get('/roles').set(auth(saA)).expect(200);
    const codes = roles.body.items.map((r: { code: string }) => r.code);
    expect(codes).not.toContain('TENANT_ADMIN');
    expect(codes).not.toContain('INDIGO_EMPLOYEE');
    // and nobody can give them to a staff member
    const ownerRole = await owner.role.findFirstOrThrow({
      where: { tenantId: A.tenant, code: 'TENANT_ADMIN' },
    });
    const attempt = await http()
      .put(`/staff/${staffA}`)
      .set(auth(saA))
      .send({ branchIds: [A.main], roles: [{ roleId: ownerRole.id, scope: 'BRANCH' }] });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
    expect(
      await owner.roleAssignment.count({ where: { userId: staffA, roleId: ownerRole.id } }),
    ).toBe(0);
  });

  it('the hidden user can never sign in with a password', async () => {
    await enter(ownerId, A.tenant).expect(200);
    const branch = await owner.branch.findFirstOrThrow({ where: { id: A.main } });
    const user = await owner.user.findFirstOrThrow({
      where: { tenantId: A.tenant, indigoHqUserId: ownerId },
    });
    for (const password of ['!', 'x', 'password', '']) {
      const res = await http()
        .post('/auth/hospital/login')
        .send({ accessCode: branch.accessCode, email: user.email, password: password || 'a' });
      expect(res.status).toBe(401);
    }
  });

  it('the database refuses to create or change the Indigo flag from anywhere else', async () => {
    const c = createPgClient('app');
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.tenant]);
      await expect(
        c.query(
          `INSERT INTO users (id, tenant_id, code, email, display_name, password_hash, indigo_hq_user_id, updated_at)
           VALUES ('forged-1', $1, 'FORGED', 'forged@example.test', 'Forged', '!', 'someone', now())`,
          [A.tenant],
        ),
      ).rejects.toThrow(/only the Indigo entry/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.tenant]);
      await expect(
        c.query(`UPDATE users SET indigo_hq_user_id = 'x' WHERE id = $1`, [staffA]),
      ).rejects.toThrow(/cannot change/);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('the access log: written on every entry, read by the hospital SuperAdmin of THAT hospital only, never edited or deleted', async () => {
    await enter(ownerId, A.tenant).expect(200);
    const log = await http().get('/indigo-access-log').set(auth(saA)).expect(200);
    expect(log.body.total).toBeGreaterThanOrEqual(1);
    expect(log.body.items[0]).toMatchObject({ action: 'ENTER', person: 'Indigo owner (Indigo)' });
    expect(Object.keys(log.body.items[0]).sort()).toEqual(['action', 'at', 'id', 'person']);
    // hospital B has seen nobody
    const other = await http().get('/indigo-access-log').set(auth(saB)).expect(200);
    expect(other.body.total).toBe(0);
    // a person without the permission is refused
    const staffToken = tokens.signHospitalAccess({
      tenantId: A.tenant,
      userId: staffA,
      branchId: A.main,
    });
    await http().get('/indigo-access-log').set(auth(staffToken)).expect(403);
    // append-only, even for the owner login of the database
    await expect(owner.indigoAccessLog.updateMany({ data: { action: 'DENIED' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.indigoAccessLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('switching an Indigo person off ends their sessions at the next refresh, and they cannot enter again', async () => {
    const hq = await makeHq('leaver', 'OWNER');
    const first = await enter(hq, A.tenant).expect(200);
    await owner.hqUser.update({ where: { id: hq }, data: { isActive: false } });
    // the HQ token cannot enter any more
    expect((await enter(hq, A.tenant)).status).toBe(403);
    // the hospital session does not refresh
    const refreshed = await http()
      .post('/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(refreshed.status).toBe(401);
    // and the old refresh token stays dead
    expect(
      (await http().post('/auth/refresh').send({ refreshToken: first.body.refreshToken })).status,
    ).toBe(401);
  });

  it('removing an Employee from a hospital ends the session there at the next refresh', async () => {
    const hq = await makeHq('moved', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: hq, tenantId: A.tenant } });
    const first = await enter(hq, A.tenant).expect(200);
    await owner.hqUserHospital.deleteMany({ where: { hqUserId: hq, tenantId: A.tenant } });
    expect(
      (await http().post('/auth/refresh').send({ refreshToken: first.body.refreshToken })).status,
    ).toBe(401);
    expect((await enter(hq, A.tenant)).status).toBe(403);
  });

  it('an Owner turned into an Employee loses the Owner role at the next entry', async () => {
    const hq = await makeHq('demoted', 'OWNER');
    await enter(hq, A.tenant).expect(200);
    await owner.hqUser.update({ where: { id: hq }, data: { indigoRole: 'EMPLOYEE' } });
    // not assigned to A as an Employee: refused
    expect((await enter(hq, A.tenant)).status).toBe(403);
    await owner.hqUserHospital.create({ data: { hqUserId: hq, tenantId: A.tenant } });
    const again = await enter(hq, A.tenant).expect(200);
    const me = await http().get('/auth/me').set(auth(again.body.accessToken)).expect(200);
    expect(me.body.roleCodes).toEqual(['INDIGO_EMPLOYEE']);
  });

  it('a hospital that is switched off cannot be entered', async () => {
    const hospital = await owner.hospital.create({
      data: {
        code: `OFF_${stamp}`,
        name: 'Switched off',
        isTest: true,
        isActive: false,
        branches: {
          create: [{ code: 'MAIN', name: 'Main', isMain: true, accessCode: `off-${stamp}` }],
        },
      },
    });
    expect((await enter(ownerId, hospital.id)).status).toBe(403);
    const list = await http()
      .get('/auth/indigo/hospitals')
      .set(auth(hqToken(ownerId)))
      .expect(200);
    expect(list.body.items.map((h: { id: string }) => h.id)).not.toContain(hospital.id);
  });
});
