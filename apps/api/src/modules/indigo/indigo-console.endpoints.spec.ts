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
 * Step 2.1e: the Indigo console API. The Owner onboards hospitals, switches modules and manages
 * Employees; an Employee only looks at the hospitals assigned to them; hospital users get nothing.
 */
describe('Indigo console (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const stamp = Date.now();
  let app: INestApplication;
  let tokens: TokenService;
  let A: KitHospital;
  let B: KitHospital;
  let ownerHq: string;
  let employeeHq: string;
  let saA: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = (id: string) => tokens.signHqAccess({ userId: id });
  const makeHq = async (label: string, indigoRole: 'OWNER' | 'EMPLOYEE') =>
    (
      await owner.hqUser.create({
        data: {
          email: `console-${label}-${stamp}@example.test`,
          displayName: `Console ${label}`,
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
    app.get(AuthRedisService).setKeyPrefix(`console-test-${stamp}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('CA');
    B = await kit.hospital('CB');
    saA = (
      await kit.person(A, 'sa', [A.main], { roleId: A.superAdminRoleId, scope: 'HOSPITAL' })
    ).token(A.main);
    ownerHq = await makeHq('owner', 'OWNER');
    employeeHq = await makeHq('employee', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: employeeHq, tenantId: A.tenant } });
  });

  afterAll(async () => {
    // the console always makes REAL hospitals (isTest false); a test database must hold none, or it refuses to rebuild
    await owner.hospital.updateMany({
      where: { code: { startsWith: 'CON_' } },
      data: { isTest: true },
    });
    await app.close();
    await owner.$disconnect();
  });

  const body = (n: string) => ({
    code: `CON_${n}_${stamp}`.toUpperCase().slice(0, 30),
    name: `Console Hospital ${n}`,
    branches: [
      { code: 'MAIN', name: 'Main', accessCode: `con-${n}-main-${stamp}`, isMain: true },
      { code: 'EAST', name: 'East', accessCode: `con-${n}-east-${stamp}`, isMain: false },
    ],
    moduleCodes: ['OPD'],
    superAdmin: { name: 'First Admin', email: `first-${n}-${stamp}@example.test` },
  });

  it('only an Indigo token gets in: no token, a hospital token and nonsense are refused', async () => {
    expect((await http().get('/indigo/hospitals')).status).toBe(401);
    expect((await http().get('/indigo/hospitals').set(auth(saA))).status).toBe(401);
    expect(
      (await http().get('/indigo/hospitals').set({ Authorization: 'Bearer nope' })).status,
    ).toBe(401);
    expect((await http().post('/indigo/hospitals').set(auth(saA)).send(body('x'))).status).toBe(
      401,
    );
  });

  it('the Owner sees every hospital with access codes and modules; an Employee only the assigned ones, without access codes', async () => {
    const all = await http()
      .get('/indigo/hospitals')
      .set(auth(hq(ownerHq)))
      .expect(200);
    expect(all.body.canManage).toBe(true);
    const ids = all.body.items.map((h: { id: string }) => h.id);
    expect(ids).toEqual(expect.arrayContaining([A.tenant, B.tenant]));
    const a = all.body.items.find((h: { id: string }) => h.id === A.tenant);
    expect(a.branches.map((b: { code: string }) => b.code).sort()).toEqual(['EAST', 'MAIN']);
    expect(typeof a.branches[0].accessCode).toBe('string');
    expect(a.modules).toContain('OPD');
    expect(all.body.moduleCatalog.map((m: { code: string }) => m.code)).toContain('OPD');

    const mine = await http()
      .get('/indigo/hospitals')
      .set(auth(hq(employeeHq)))
      .expect(200);
    expect(mine.body.canManage).toBe(false);
    expect(mine.body.items.map((h: { id: string }) => h.id)).toEqual([A.tenant]);
    expect(JSON.stringify(mine.body)).not.toContain('accessCode');
  });

  it('an Employee cannot onboard, change modules or manage Employees (403)', async () => {
    const e = auth(hq(employeeHq));
    expect((await http().post('/indigo/hospitals').set(e).send(body('emp'))).status).toBe(403);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/modules`)
          .set(e)
          .send({ moduleCodes: ['OPD'] })
      ).status,
    ).toBe(403);
    expect((await http().get('/indigo/employees').set(e)).status).toBe(403);
    expect(
      (await http().post('/indigo/employees').set(e).send({ name: 'X', email: 'x@example.test' }))
        .status,
    ).toBe(403);
    expect(
      (
        await http()
          .put(`/indigo/employees/${employeeHq}/hospitals`)
          .set(e)
          .send({ hospitalIds: [A.tenant, B.tenant] })
      ).status,
    ).toBe(403);
    expect(await owner.hospital.count({ where: { code: body('emp').code } })).toBe(0);
  });

  it('the Owner onboards a hospital: branches, modules, roles, a first SuperAdmin who can sign in, and an audit entry without the password', async () => {
    const input = body('ok');
    const res = await http()
      .post('/indigo/hospitals')
      .set(auth(hq(ownerHq)))
      .send(input);
    expect(res.status).toBe(201);
    expect(res.body.hospital.code).toBe(input.code);
    const temp: string = res.body.superAdmin.temporaryPassword;
    expect(temp.length).toBeGreaterThanOrEqual(12);
    expect(res.body.nextStep).toContain(input.code);
    const hospital = await owner.hospital.findUniqueOrThrow({ where: { code: input.code } });
    expect(hospital).toMatchObject({ status: 'ACTIVE', isTest: false, isActive: true });
    expect(await owner.branch.count({ where: { tenantId: hospital.id } })).toBe(2);
    expect(
      (await owner.branch.findMany({ where: { tenantId: hospital.id, isMain: true } })).map(
        (b) => b.accessCode,
      ),
    ).toEqual([input.branches[0]!.accessCode]);
    // the four system roles exist, the Super Admin with permissions
    const roles = await owner.role.findMany({
      where: { tenantId: hospital.id },
      select: { code: true },
    });
    expect(roles.map((r) => r.code).sort()).toEqual([
      'BRANCH_ADMIN',
      'INDIGO_EMPLOYEE',
      'SUPER_ADMIN',
      'TENANT_ADMIN',
    ]);
    expect(await owner.rolePermission.count({ where: { tenantId: hospital.id } })).toBeGreaterThan(
      40,
    );
    // modules switched on for the hospital and every branch
    expect(
      await owner.hospitalModuleSubscription.count({
        where: { tenantId: hospital.id, isActive: true },
      }),
    ).toBe(1);
    expect(
      await owner.branchModule.count({ where: { tenantId: hospital.id, isActive: true } }),
    ).toBe(2);
    // the first SuperAdmin signs in with the access code and must change the password
    const login = await http().post('/auth/hospital/login').send({
      accessCode: input.branches[0]!.accessCode,
      email: input.superAdmin.email,
      password: temp,
    });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    // the audit entry names the Indigo person by id and holds no secret
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { tenantId: hospital.id, action: 'INDIGO_HOSPITAL_ONBOARD' },
    });
    expect(audit.metadata).toMatchObject({ hqUserId: ownerHq });
    expect(JSON.stringify(audit)).not.toContain(temp);
    // and the Owner can enter the new hospital at once
    const entered = await http()
      .post('/auth/indigo/enter')
      .set(auth(hq(ownerHq)))
      .send({ hospitalId: hospital.id });
    expect(entered.status).toBe(200);
  });

  it('refuses a taken code, a taken access code, two main branches, no OPD, an unknown module, extra fields and a bad email', async () => {
    const o = auth(hq(ownerHq));
    const take = body('dup');
    await http().post('/indigo/hospitals').set(o).send(take).expect(201);
    const sameCode = await http()
      .post('/indigo/hospitals')
      .set(o)
      .send({
        ...take,
        branches: [{ code: 'MAIN', name: 'M', accessCode: `other-code-${stamp}`, isMain: true }],
      });
    expect(sameCode.status).toBe(409);
    expect(sameCode.body).toMatchObject({ code: 'INDIGO_CONFLICT', field: 'code' });
    const sameAccess = await http()
      .post('/indigo/hospitals')
      .set(o)
      .send({
        ...body('dup2'),
        branches: [
          { code: 'MAIN', name: 'M', accessCode: take.branches[0]!.accessCode, isMain: true },
        ],
      });
    expect(sameAccess.status).toBe(409);
    expect(sameAccess.body.reason).toBe('ACCESS_CODE_TAKEN');
    const bad = async (patch: object, field: string) => {
      const res = await http()
        .post('/indigo/hospitals')
        .set(o)
        .send({ ...body(`bad${field.length}${Math.random().toString(36).slice(2, 6)}`), ...patch });
      expect({ field, status: res.status }).toEqual({ field, status: 400 });
    };
    await bad(
      {
        branches: [
          { code: 'A', name: 'A', accessCode: `aaaaaa-${stamp}`, isMain: true },
          { code: 'B', name: 'B', accessCode: `bbbbbb-${stamp}`, isMain: true },
        ],
      },
      'two-main',
    );
    await bad({ moduleCodes: ['IPD'] }, 'no-opd');
    await bad({ moduleCodes: ['OPD', 'NOT_A_MODULE'] }, 'unknown-module');
    await bad({ superAdmin: { name: 'X', email: 'not-an-email' } }, 'email');
    await bad(
      { branches: [{ code: 'A', name: 'A', accessCode: 'short', isMain: true }] },
      'short-access',
    );
    await bad({ surprise: true }, 'extra');
    await bad({ code: 'lower case!' }, 'code');
  });

  it('the Owner switches a module off and on; the audit says which, and an Employee cannot', async () => {
    const o = auth(hq(ownerHq));
    const catalog = await http().get('/indigo/hospitals').set(o).expect(200);
    const extra = catalog.body.moduleCatalog.find((m: { code: string }) => m.code !== 'OPD');
    expect(extra).toBeDefined();
    const on = await http()
      .put(`/indigo/hospitals/${B.tenant}/modules`)
      .set(o)
      .send({ moduleCodes: ['OPD', extra.code] })
      .expect(200);
    expect(on.body.moduleCodes).toEqual(['OPD', extra.code].sort());
    expect(
      await owner.branchModule.count({ where: { tenantId: B.tenant, isActive: true } }),
    ).toBeGreaterThanOrEqual(4);
    const off = await http()
      .put(`/indigo/hospitals/${B.tenant}/modules`)
      .set(o)
      .send({ moduleCodes: ['OPD'] })
      .expect(200);
    expect(off.body.moduleCodes).toEqual(['OPD']);
    const subs = await owner.hospitalModuleSubscription.findMany({
      where: { tenantId: B.tenant, isActive: true },
      include: { module: true },
    });
    expect(subs.map((s) => s.module.code)).toEqual(['OPD']);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${B.tenant}/modules`)
          .set(o)
          .send({ moduleCodes: [extra.code] })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${B.tenant}/modules`)
          .set(o)
          .send({ moduleCodes: ['OPD', 'NOPE'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .put('/indigo/hospitals/does-not-exist/modules')
          .set(o)
          .send({ moduleCodes: ['OPD'] })
      ).status,
    ).toBe(403);
    const audit = await owner.auditLog.findMany({
      where: { tenantId: B.tenant, action: 'INDIGO_MODULES_CHANGE' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[0]!.metadata).toMatchObject({ hqUserId: ownerHq });
  });

  it('the Owner creates an Employee, assigns hospitals (audited in each), and the Employee reaches only those', async () => {
    const o = auth(hq(ownerHq));
    const made = await http()
      .post('/indigo/employees')
      .set(o)
      .send({ name: 'New Employee', email: `emp-${stamp}@example.test` });
    expect(made.status).toBe(201);
    expect(made.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const row = await owner.hqUser.findUniqueOrThrow({ where: { id: made.body.id } });
    expect(row).toMatchObject({ indigoRole: 'EMPLOYEE', mustChangePassword: true, isActive: true });
    expect(row.passwordHash).not.toContain(made.body.temporaryPassword);
    expect(
      (
        await http()
          .post('/indigo/employees')
          .set(o)
          .send({ name: 'Again', email: `emp-${stamp}@example.test` })
      ).status,
    ).toBe(409);
    expect(
      (
        await http()
          .post('/indigo/employees')
          .set(o)
          .send({ name: 'Role', email: `r-${stamp}@example.test`, indigoRole: 'OWNER' })
      ).status,
    ).toBe(400);

    const id: string = made.body.id;
    // not yet assigned: nothing to enter
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hq(id)))
          .send({ hospitalId: B.tenant })
      ).status,
    ).toBe(403);
    await http()
      .put(`/indigo/employees/${id}/hospitals`)
      .set(o)
      .send({ hospitalIds: [A.tenant, B.tenant] })
      .expect(200);
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hq(id)))
          .send({ hospitalId: B.tenant })
      ).status,
    ).toBe(200);
    // replacing the list removes B again
    await http()
      .put(`/indigo/employees/${id}/hospitals`)
      .set(o)
      .send({ hospitalIds: [A.tenant] })
      .expect(200);
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hq(id)))
          .send({ hospitalId: B.tenant })
      ).status,
    ).toBe(403);
    const listed = await http().get('/indigo/employees').set(o).expect(200);
    expect(listed.body.items.find((e: { id: string }) => e.id === id).hospitalIds).toEqual([
      A.tenant,
    ]);
    expect(
      (
        await http()
          .put(`/indigo/employees/${id}/hospitals`)
          .set(o)
          .send({ hospitalIds: ['no-such'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .put(`/indigo/employees/${ownerHq}/hospitals`)
          .set(o)
          .send({ hospitalIds: [A.tenant] })
      ).status,
    ).toBe(403);
    const assigned = await owner.auditLog.findMany({
      where: {
        tenantId: B.tenant,
        action: { in: ['INDIGO_EMPLOYEE_ASSIGNED', 'INDIGO_EMPLOYEE_UNASSIGNED'] },
      },
    });
    expect(assigned.map((r) => r.action).sort()).toEqual([
      'INDIGO_EMPLOYEE_ASSIGNED',
      'INDIGO_EMPLOYEE_UNASSIGNED',
    ]);
  });

  it('switching an Employee off closes the door at once; an Owner cannot be switched off here; switching on reopens it', async () => {
    const o = auth(hq(ownerHq));
    const id = await makeHq('toggle', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: id, tenantId: A.tenant } });
    const first = await http()
      .post('/auth/indigo/enter')
      .set(auth(hq(id)))
      .send({ hospitalId: A.tenant })
      .expect(200);
    await http().post(`/indigo/employees/${id}/deactivate`).set(o).expect(200);
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hq(id)))
          .send({ hospitalId: A.tenant })
      ).status,
    ).toBe(403);
    expect(
      (await http().post('/auth/refresh').send({ refreshToken: first.body.refreshToken })).status,
    ).toBe(401);
    expect((await http().post(`/indigo/employees/${ownerHq}/deactivate`).set(o)).status).toBe(403);
    await http().post(`/indigo/employees/${id}/reactivate`).set(o).expect(200);
    expect(
      (
        await http()
          .post('/auth/indigo/enter')
          .set(auth(hq(id)))
          .send({ hospitalId: A.tenant })
      ).status,
    ).toBe(200);
  });
});
