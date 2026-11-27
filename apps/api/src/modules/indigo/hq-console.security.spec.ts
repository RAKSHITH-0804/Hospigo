import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { AuthRedisService } from '../auth/auth-redis.service';
import type { TokenService } from '../auth/token.service';

prepareTestEnv();
process.env.AUTH_IP_RATE_LIMIT_PER_MIN = '1000';

/**
 * Phase 2.2 checkpoint 2, review gate: HQ Staff tick-box permissions (deny by default, only for the
 * assigned hospitals), the append-only HQ activity log, counts-only monitoring, and the Super Admin
 * reset without entering the hospital.
 */
describe('HQ console permissions, monitoring and Super Admin reset (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const stamp = Date.now();
  let app: INestApplication;
  let tokens: TokenService;
  let A: KitHospital;
  let B: KitHospital;
  let admin: string;
  let staff: string;
  let kitSaA: { id: string; email: string };

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = (id: string) => tokens.signHqAccess({ userId: id });
  const makeHq = async (label: string, indigoRole: 'OWNER' | 'EMPLOYEE') =>
    (
      await owner.hqUser.create({
        data: {
          email: `cp2-${label}-${stamp}@example.test`,
          displayName: `CP2 ${label}`,
          passwordHash: 'x',
          mustChangePassword: false,
          indigoRole,
        },
      })
    ).id;
  const tick = (id: string, permissions: string[]) =>
    http()
      .put(`/indigo/employees/${id}/permissions`)
      .set(auth(hq(admin)))
      .send({ permissions })
      .expect(200);

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    tokens = booted.tokens;
    app.get(AuthRedisService).setKeyPrefix(`cp2-test-${stamp}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('PA');
    B = await kit.hospital('PB');
    const sa = await kit.person(A, 'sa', [A.main], {
      roleId: A.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    const row = await owner.user.findUniqueOrThrow({ where: { id: sa.id } });
    kitSaA = { id: sa.id, email: row.email };
    admin = await makeHq('admin', 'OWNER');
    staff = await makeHq('staff', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: staff, tenantId: A.tenant } });
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('HQ Staff with no ticks can do nothing (deny by default)', async () => {
    const s = auth(hq(staff));
    expect((await http().get('/indigo/hospitals').set(s).expect(200)).body.items).toEqual([]);
    for (const path of ['/indigo/monitoring', '/indigo/health', '/indigo/activity']) {
      expect([path, (await http().get(path).set(s)).status]).toEqual([path, 403]);
    }
    expect((await http().get(`/indigo/hospitals/${A.tenant}/super-admins`).set(s)).status).toBe(
      403,
    );
    expect(
      (await http().post(`/indigo/hospitals/${A.tenant}/super-admins/x/reset`).set(s)).status,
    ).toBe(403);
    expect((await http().get('/indigo/library').set(s)).status).toBe(403);
  });

  it('only an HQ Admin ticks permissions; unknown or admin-only names are refused; the activity log records it', async () => {
    expect(
      (
        await http()
          .put(`/indigo/employees/${staff}/permissions`)
          .set(auth(hq(staff)))
          .send({ permissions: ['hq.monitor'] })
      ).status,
    ).toBe(403);
    for (const bad of [['nope'], ['hq.staff.manage'], ['hq.activity.read'], 'x', null]) {
      const res = await http()
        .put(`/indigo/employees/${staff}/permissions`)
        .set(auth(hq(admin)))
        .send({ permissions: bad });
      expect([bad, res.status]).toEqual([bad, 400]);
    }
    // an HQ Admin cannot be given ticks (they have everything already)
    expect(
      (
        await http()
          .put(`/indigo/employees/${admin}/permissions`)
          .set(auth(hq(admin)))
          .send({ permissions: ['hq.monitor'] })
      ).status,
    ).toBe(403);
    await tick(staff, ['hq.hospitals.view', 'hq.monitor']);
    const list = await http()
      .get('/indigo/employees')
      .set(auth(hq(admin)))
      .expect(200);
    expect(list.body.items.find((e: { id: string }) => e.id === staff).permissions).toEqual([
      'hq.hospitals.view',
      'hq.monitor',
    ]);
    const log = await http()
      .get('/indigo/activity')
      .set(auth(hq(admin)))
      .expect(200);
    expect(log.body.items[0]).toMatchObject({ action: 'HQ_STAFF_PERMISSIONS' });
    // HQ Staff never read the activity log, even with every tick
    await tick(staff, [
      'hq.hospitals.view',
      'hq.monitor',
      'hq.onboard',
      'hq.modules',
      'hq.print',
      'hq.terminology',
      'hq.superadmin.reset',
    ]);
    expect(
      (
        await http()
          .get('/indigo/activity')
          .set(auth(hq(staff)))
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .get('/indigo/employees')
          .set(auth(hq(staff)))
      ).status,
    ).toBe(403);
    // and can still not manage HQ Staff or touch hospitals outside the assignment
    expect(
      (
        await http()
          .put(`/indigo/employees/${staff}/permissions`)
          .set(auth(hq(staff)))
          .send({ permissions: [] })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${B.tenant}/super-admins`)
          .set(auth(hq(staff)))
          .send({ name: 'X', email: 'x@example.test' })
      ).status,
    ).toBe(403);
    await tick(staff, ['hq.hospitals.view', 'hq.monitor']);
  });

  it('the activity log cannot be changed or deleted, not even by the owner login', async () => {
    const row = await owner.hqActivityLog.findFirstOrThrow();
    await expect(
      owner.hqActivityLog.update({ where: { id: row.id }, data: { action: 'X' } }),
    ).rejects.toThrow();
    await expect(owner.hqActivityLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it('monitoring gives counts only, for the assigned hospitals only; health is one status', async () => {
    await owner.user.update({ where: { id: kitSaA.id }, data: { lastLoginAt: new Date() } });
    const a = await http()
      .get('/indigo/monitoring')
      .set(auth(hq(admin)))
      .expect(200);
    const ids = a.body.items.map((i: { hospitalId: string }) => i.hospitalId);
    expect(ids).toEqual(expect.arrayContaining([A.tenant, B.tenant]));
    const mineA = a.body.items.find((i: { hospitalId: string }) => i.hospitalId === A.tenant);
    expect(Object.keys(mineA).sort()).toEqual([
      'activeUsers30d',
      'hospitalId',
      'lastActivity',
      'visits30d',
      'visits7d',
      'visitsToday',
    ]);
    expect(mineA.activeUsers30d).toBeGreaterThanOrEqual(1);
    expect(mineA.lastActivity).not.toBeNull();
    const s = await http()
      .get('/indigo/monitoring')
      .set(auth(hq(staff)))
      .expect(200);
    expect(s.body.items.map((i: { hospitalId: string }) => i.hospitalId)).toEqual([A.tenant]);
    expect(JSON.stringify(a.body)).not.toMatch(/name|patient|amount|paise/i);
    const h = await http()
      .get('/indigo/health')
      .set(auth(hq(admin)))
      .expect(200);
    expect(Object.keys(h.body).sort()).toEqual([
      'api',
      'checkedAt',
      'database',
      'migrations',
      'status',
      'storage',
    ]);
    // a hospital token never reaches it
    const kit = createKit(owner, tokens);
    const person = await kit.person(A, 'mon', [A.main], {
      roleId: A.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    expect(
      (
        await http()
          .get('/indigo/monitoring')
          .set(auth(person.token(A.main)))
      ).status,
    ).toBe(401);
  });

  it('a Super Admin is reset without entering: one-time password, old sessions end, other hospitals are safe', async () => {
    await tick(staff, ['hq.hospitals.view', 'hq.superadmin.reset']);
    const list = await http()
      .get(`/indigo/hospitals/${A.tenant}/super-admins`)
      .set(auth(hq(admin)))
      .expect(200);
    expect(list.body.items.map((u: { id: string }) => u.id)).toContain(kitSaA.id);
    // HQ Staff on the assigned hospital may reset; on another hospital never
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${B.tenant}/super-admins/${kitSaA.id}/reset`)
          .set(auth(hq(staff)))
      ).status,
    ).toBe(403);
    // an HQ Admin naming the wrong hospital for a user gets the same plain refusal
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${B.tenant}/super-admins/${kitSaA.id}/reset`)
          .set(auth(hq(admin)))
      ).status,
    ).toBe(403);
    // a user who is not a Super Admin cannot be reset
    const kit = createKit(owner, tokens);
    const clerk = await kit.person(A, 'clerk', [A.main], {
      permissions: ['opd.visits.read'],
      scope: 'BRANCH',
    });
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${A.tenant}/super-admins/${clerk.id}/reset`)
          .set(auth(hq(admin)))
      ).status,
    ).toBe(403);
    const reset = await http()
      .post(`/indigo/hospitals/${A.tenant}/super-admins/${kitSaA.id}/reset`)
      .set(auth(hq(staff)))
      .expect(200);
    expect(reset.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const row = await owner.user.findUniqueOrThrow({ where: { id: kitSaA.id } });
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordHash).not.toContain(reset.body.temporaryPassword);
    const log = await owner.hqActivityLog.findFirstOrThrow({
      where: { action: 'HQ_SUPERADMIN_RESET', hqUserId: staff },
    });
    expect(JSON.stringify(log.detail)).not.toContain(reset.body.temporaryPassword);
    const audit = await owner.auditLog.findFirst({
      where: { tenantId: A.tenant, action: 'HQ_RESET_SUPERADMIN_PASSWORD' },
    });
    expect(audit).not.toBeNull();
  });

  it('a second first Super Admin is refused; the first can be created for a hospital without one', async () => {
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${A.tenant}/super-admins`)
          .set(auth(hq(admin)))
          .send({ name: 'Second', email: `second-${stamp}@example.test` })
      ).status,
    ).toBe(409);
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${A.tenant}/super-admins`)
          .set(auth(hq(admin)))
          .send({ name: 'Second', email: `second-${stamp}@example.test`, role: 'x' })
      ).status,
    ).toBe(400);
  });
});
