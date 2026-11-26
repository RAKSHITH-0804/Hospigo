import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { AuthRedisService } from '../auth/auth-redis.service';
import type { TokenService } from '../auth/token.service';
import { makePng } from '../images/image-test.util';
import { sampleTemplates } from '../print-templates/sample-templates';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.service';

prepareTestEnv();
process.env.AUTH_IP_RATE_LIMIT_PER_MIN = '1000';

/**
 * Step 2.1f: the template library (Indigo adds and assigns, a hospital only chooses what is assigned),
 * terminology overrides, a module switch for one branch, and the starter masters from the console.
 */
describe('Indigo library, terminology, branch modules and starter (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const stamp = Date.now();
  let app: INestApplication;
  let tokens: TokenService;
  let storage: StorageService;
  let A: KitHospital;
  let B: KitHospital;
  let ownerHq: string;
  let employeeHq: string;
  let otherEmployeeHq: string;
  let saA: string;
  let adminA: string;
  let adminB: string;
  let nobodyA: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = (id: string) => tokens.signHqAccess({ userId: id });
  const makeHq = async (label: string, indigoRole: 'OWNER' | 'EMPLOYEE') =>
    (
      await owner.hqUser.create({
        data: {
          email: `lib-${label}-${stamp}@example.test`,
          displayName: `Library ${label}`,
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
    storage = app.get(STORAGE_SERVICE);
    app.get(AuthRedisService).setKeyPrefix(`lib-test-${stamp}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('LA');
    B = await kit.hospital('LB');
    saA = (
      await kit.person(A, 'sa', [A.main, A.east], { roleId: A.superAdminRoleId, scope: 'HOSPITAL' })
    ).token(A.main);
    adminA = (
      await kit.person(A, 'ba', [A.main], { roleId: A.branchAdminRoleId, scope: 'BRANCH' })
    ).token(A.main);
    adminB = (
      await kit.person(B, 'sa', [B.main], { roleId: B.superAdminRoleId, scope: 'HOSPITAL' })
    ).token(B.main);
    nobodyA = (await kit.person(A, 'nobody', [A.main])).token(A.main);
    ownerHq = await makeHq('owner', 'OWNER');
    employeeHq = await makeHq('employee', 'EMPLOYEE');
    otherEmployeeHq = await makeHq('other', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: employeeHq, tenantId: A.tenant } });
    await owner.hqUserHospital.create({ data: { hqUserId: otherEmployeeHq, tenantId: B.tenant } });
  });

  afterAll(async () => {
    const images = await owner.storedImage.findMany({
      where: { tenantId: { in: [A.tenant, B.tenant] } },
    });
    for (const row of images) {
      await storage.delete(row.tenantId, row.storageKey).catch(() => undefined);
    }
    await owner.hospital.updateMany({
      where: { code: { startsWith: 'LIB_' } },
      data: { isTest: true },
    });
    await app.close();
    await owner.$disconnect();
  });

  const o = () => auth(hq(ownerHq));

  it('only the Owner touches the library: an Employee gets 403, a hospital token 401, no token 401', async () => {
    const e = auth(hq(employeeHq));
    expect((await http().get('/indigo/library').set(e)).status).toBe(403);
    expect((await http().post('/indigo/library/samples').set(e)).status).toBe(403);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/library`)
          .set(e)
          .send({ templateIds: [], logoIds: [] })
      ).status,
    ).toBe(403);
    expect((await http().get('/indigo/library').set(auth(saA))).status).toBe(401);
    expect((await http().get('/indigo/library')).status).toBe(401);
  });

  it('the Owner adds the designed samples (twice is safe), a copy and a preset template, and a logo', async () => {
    const first = await http().post('/indigo/library/samples').set(o()).expect(200);
    const second = await http().post('/indigo/library/samples').set(o()).expect(200);
    expect(second.body.added).toBe(0);
    expect(first.body.added + (await owner.printLibraryTemplate.count()) - first.body.added).toBe(
      await owner.printLibraryTemplate.count(),
    );
    const overview = (await http().get('/indigo/library').set(o()).expect(200)).body;
    expect(overview.samplesMissing).toBe(0);
    expect(overview.templates.length).toBeGreaterThanOrEqual(sampleTemplates().length);
    const source = overview.templates.find((t: { key: string }) => t.key === 'bill-classic');
    const copy = await http()
      .post('/indigo/library/templates')
      .set(o())
      .send({ copyOf: source.id, name: `Bill copy ${stamp}` })
      .expect(201);
    expect(copy.body.id).toBeTruthy();
    expect(
      (
        await http()
          .post('/indigo/library/templates')
          .set(o())
          .send({ copyOf: source.id, name: `Bill copy ${stamp}` })
      ).status,
    ).toBe(409);
    await http()
      .post('/indigo/library/templates')
      .set(o())
      .send({ docType: 'PATIENT_CARD', name: `Card preset ${stamp}`, preset: 'CARD_LABEL' })
      .expect(201);
    for (const bad of [
      { docType: 'NOPE', name: 'x' },
      { docType: 'RECEIPT', name: '' },
      { docType: 'RECEIPT', name: 'x', preset: 'NOPE' },
      { docType: 'RECEIPT', name: 'x', extra: 1 },
      { copyOf: 'nope', name: 'x' },
    ]) {
      expect((await http().post('/indigo/library/templates').set(o()).send(bad)).status).toBe(400);
    }
    // a logo: a real picture only
    const png = makePng(64, 64);
    const logo = await http()
      .post(`/indigo/library/logos?name=Logo%20${stamp}`)
      .set(o())
      .attach('file', png, { filename: 'l.png', contentType: 'image/png' })
      .expect(201);
    expect(logo.body.id).toBeTruthy();
    expect(
      (
        await http()
          .post(`/indigo/library/logos?name=Bad%20${stamp}`)
          .set(o())
          .attach('file', Buffer.from('not a picture'), {
            filename: 'x.png',
            contentType: 'image/png',
          })
      ).status,
    ).toBe(400);
    const image = await http()
      .get(`/indigo/library/logos/${logo.body.id}/image`)
      .set(o())
      .expect(200);
    expect(image.headers['content-type']).toContain('image/png');
  });

  it('assigned to one hospital, chosen there (hospital and branch), invisible to another hospital, refused to people without the permission', async () => {
    const overview = (await http().get('/indigo/library').set(o())).body;
    const receipts = overview.templates.filter(
      (t: { docType: string; key: string }) => t.docType === 'RECEIPT' && t.key.startsWith('bill-'),
    );
    const logo = overview.logos.find((l: { name: string }) => l.name === `Logo ${stamp}`);
    const ids = receipts.slice(0, 2).map((t: { id: string }) => t.id);
    await http()
      .put(`/indigo/hospitals/${A.tenant}/library`)
      .set(o())
      .send({ templateIds: ids, logoIds: [logo.id] })
      .expect(200);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/library`)
          .set(o())
          .send({ templateIds: ['nope'], logoIds: [] })
      ).status,
    ).toBe(400);
    expect(
      await owner.auditLog.count({
        where: { tenantId: A.tenant, action: 'INDIGO_LIBRARY_ASSIGN' },
      }),
    ).toBe(1);
    // A's SuperAdmin sees exactly what is assigned; B sees nothing
    const seen = (await http().get('/print-library').set(auth(saA)).expect(200)).body;
    expect(seen.templates.map((t: { id: string }) => t.id).sort()).toEqual([...ids].sort());
    expect(seen.logos).toHaveLength(1);
    expect(seen.canChoose).toEqual({ branch: true, hospital: true });
    const seenB = (await http().get('/print-library').set(auth(adminB)).expect(200)).body;
    expect(seenB.templates).toHaveLength(0);
    expect(seenB.logos).toHaveLength(0);
    // a template of another hospital's list cannot be chosen (404, as if it did not exist)
    expect(
      (await http().put(`/print-library/templates/${ids[0]}/choose`).set(auth(adminB))).status,
    ).toBe(404);
    expect(
      (
        await http()
          .put(`/print-library/templates/${overview.templates[0].id}/choose`)
          .set(auth(saA))
      ).status,
    ).toBe(404);
    // nobody with no role, and no token
    expect((await http().get('/print-library').set(auth(nobodyA))).status).toBe(403);
    expect(
      (await http().put(`/print-library/templates/${ids[0]}/choose`).set(auth(nobodyA))).status,
    ).toBe(403);
    expect((await http().get('/print-library')).status).toBe(401);
    // the SuperAdmin chooses for the hospital; the Admin only for the own branch
    const chosen = await http()
      .put(`/print-library/templates/${ids[0]}/choose`)
      .set(auth(saA))
      .expect(200);
    expect(chosen.body.scope).toBe('HOSPITAL');
    // choosing the same design again, or another one for the same document, replaces it (no error)
    await http().put(`/print-library/templates/${ids[0]}/choose`).set(auth(saA)).expect(200);
    await http().put(`/print-library/templates/${ids[1]}/choose`).set(auth(saA)).expect(200);
    await http().put(`/print-library/templates/${ids[0]}/choose`).set(auth(saA)).expect(200);
    expect(
      (
        await http()
          .put(`/print-library/templates/${ids[1]}/choose?scope=hospital`)
          .set(auth(adminA))
      ).status,
    ).toBe(403);
    const branchChoice = await http()
      .put(`/print-library/templates/${ids[1]}/choose?scope=branch`)
      .set(auth(adminA))
      .expect(200);
    expect(branchChoice.body.scope).toBe('BRANCH');
    const active = (await http().get('/print-library').set(auth(adminA))).body.templates;
    expect(
      active.filter((t: { active: boolean }) => t.active).map((t: { id: string }) => t.id),
    ).toEqual([ids[1]]);
    // the chosen design is the one that prints: the hospital copy remembers where it came from
    const row = await owner.printTemplate.findFirst({
      where: { tenantId: A.tenant, branchId: null, docType: 'RECEIPT', retiredAt: null },
    });
    expect(row?.libraryTemplateId).toBe(ids[0]);
    // the logo: picked from the library, becomes the hospital logo; an Admin of one branch may not
    expect(
      (await http().put(`/print-library/logos/${logo.id}/choose`).set(auth(adminA))).status,
    ).toBe(403);
    await http().put(`/print-library/logos/${logo.id}/choose`).set(auth(saA)).expect(200);
    expect(
      await owner.storedImage.count({
        where: { tenantId: A.tenant, purpose: 'HOSPITAL_LOGO', isCurrent: true },
      }),
    ).toBe(1);
    expect(
      (await http().put(`/print-library/logos/${logo.id}/choose`).set(auth(adminB))).status,
    ).toBe(404);
    const picture = await http()
      .get(`/print-library/logos/${logo.id}/image`)
      .set(auth(saA))
      .expect(200);
    expect(picture.headers['content-type']).toContain('image/png');
    expect(
      (await http().get(`/print-library/logos/${logo.id}/image`).set(auth(adminB))).status,
    ).toBe(404);
    // taking an assignment away removes it from the list at once
    await http()
      .put(`/indigo/hospitals/${A.tenant}/library`)
      .set(o())
      .send({ templateIds: [ids[1]], logoIds: [] })
      .expect(200);
    const after = (await http().get('/print-library').set(auth(saA))).body;
    expect(after.templates.map((t: { id: string }) => t.id)).toEqual([ids[1]]);
    expect(after.logos).toHaveLength(0);
  });

  it('the hospital login cannot write the library, the assignments or the words (database level)', async () => {
    const { createPgClient } = await import('../../database/db-test.util');
    const pg = createPgClient('app');
    await pg.connect();
    try {
      for (const sql of [
        "INSERT INTO print_library_templates (id, doc_type, key, name, input) VALUES ('x1','RECEIPT','x1','x','{}')",
        `INSERT INTO print_library_assignments (id, tenant_id, template_id) VALUES ('x1','${A.tenant}','x')`,
        `INSERT INTO terminology_overrides (id, tenant_id, key, text) VALUES ('x1','${A.tenant}','patient','x')`,
      ]) {
        await expect(pg.query(sql)).rejects.toThrow(/permission denied/i);
      }
    } finally {
      await pg.end();
    }
  });

  it('terminology: the Owner and an assigned Employee set words; another Employee cannot; the hospital reads them; plain words only', async () => {
    const e = auth(hq(employeeHq));
    await http()
      .put(`/indigo/hospitals/${A.tenant}/terminology`)
      .set(e)
      .send({ items: { patient: 'Client', queue: 'Waiting line' } })
      .expect(200);
    expect((await http().get('/terminology').set(auth(nobodyA))).body.items).toEqual({
      patient: 'Client',
      queue: 'Waiting line',
    });
    expect((await http().get('/terminology').set(auth(adminB))).body.items).toEqual({});
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/terminology`)
          .set(auth(hq(otherEmployeeHq)))
          .send({ items: { patient: 'X' } })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .get(`/indigo/hospitals/${A.tenant}/terminology`)
          .set(auth(hq(otherEmployeeHq)))
      ).status,
    ).toBe(403);
    for (const bad of [
      { items: { 'bad key': 'x' } },
      { items: { patient: '<b>x</b>' } },
      { items: { patient: 'x'.repeat(61) } },
      { items: { patient: 5 } },
      { items: {}, extra: 1 },
      { nothing: true },
    ]) {
      expect(
        (await http().put(`/indigo/hospitals/${A.tenant}/terminology`).set(o()).send(bad)).status,
      ).toBe(400);
    }
    await http()
      .put(`/indigo/hospitals/${A.tenant}/terminology`)
      .set(o())
      .send({ items: { queue: null } })
      .expect(200);
    expect((await http().get('/terminology').set(auth(saA))).body.items).toEqual({
      patient: 'Client',
    });
    const audit = await owner.auditLog.findMany({
      where: { tenantId: A.tenant, action: 'INDIGO_TERMS_CHANGE' },
    });
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('Client');
    expect((await http().get('/terminology')).status).toBe(401);
  });

  it('a module switch for ONE branch changes only that branch; OPD stays; a module the hospital does not hold is refused; an Employee cannot', async () => {
    const mods = await owner.module.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
    });
    const extra = mods.find((m) => m.code !== 'OPD');
    if (!extra) {
      return;
    }
    await http()
      .put(`/indigo/hospitals/${A.tenant}/modules`)
      .set(o())
      .send({ moduleCodes: ['OPD', extra.code] })
      .expect(200);
    const on = (branchId: string) =>
      owner.branchModule.count({
        where: { tenantId: A.tenant, branchId, moduleId: extra.id, isActive: true },
      });
    expect(await on(A.main)).toBe(1);
    expect(await on(A.east)).toBe(1);
    await http()
      .put(`/indigo/hospitals/${A.tenant}/branches/${A.east}/modules`)
      .set(o())
      .send({ moduleCodes: ['OPD'] })
      .expect(200);
    expect(await on(A.main)).toBe(1);
    expect(await on(A.east)).toBe(0);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/branches/${A.east}/modules`)
          .set(o())
          .send({ moduleCodes: [extra.code] })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${B.tenant}/branches/${B.main}/modules`)
          .set(o())
          .send({ moduleCodes: ['OPD', extra.code] })
      ).status,
    ).toBe(400);
    // a branch of another hospital is refused
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/branches/${B.main}/modules`)
          .set(o())
          .send({ moduleCodes: ['OPD'] })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/branches/${A.east}/modules`)
          .set(auth(hq(employeeHq)))
          .send({ moduleCodes: ['OPD'] })
      ).status,
    ).toBe(403);
    expect(
      await owner.auditLog.count({
        where: { tenantId: A.tenant, action: 'INDIGO_BRANCH_MODULES_CHANGE' },
      }),
    ).toBe(1);
  });

  it('the starter masters from the console: payment modes, vitals and number series appear once; pressing twice keeps them; an Employee cannot', async () => {
    const body = {
      code: `LIB_${stamp}`.toUpperCase().slice(0, 30),
      name: 'Library Starter Hospital',
      branches: [{ code: 'MAIN', name: 'Main', accessCode: `lib-main-${stamp}`, isMain: true }],
      moduleCodes: ['OPD'],
      superAdmin: { name: 'First Admin', email: `lib-first-${stamp}@example.test` },
    };
    const made = await http().post('/indigo/hospitals').set(o()).send(body).expect(201);
    const id = made.body.hospital.id as string;
    expect(
      (
        await http()
          .post(`/indigo/hospitals/${id}/starter`)
          .set(auth(hq(employeeHq)))
      ).status,
    ).toBe(403);
    const first = await http().post(`/indigo/hospitals/${id}/starter`).set(o()).expect(200);
    expect(first.body.created.length).toBeGreaterThan(0);
    expect(await owner.paymentMode.count({ where: { tenantId: id } })).toBeGreaterThan(0);
    expect(await owner.vitalsField.count({ where: { tenantId: id } })).toBeGreaterThan(0);
    expect(await owner.numberSeriesSettings.count({ where: { tenantId: id } })).toBeGreaterThan(0);
    const counts = await owner.paymentMode.count({ where: { tenantId: id } });
    const second = await http().post(`/indigo/hospitals/${id}/starter`).set(o()).expect(200);
    expect(second.body.created).toEqual([]);
    expect(await owner.paymentMode.count({ where: { tenantId: id } })).toBe(counts);
    expect(
      await owner.auditLog.count({ where: { tenantId: id, action: 'INDIGO_STARTER_RUN' } }),
    ).toBe(2);
    expect((await http().post(`/indigo/hospitals/nope/starter`).set(o())).status).toBe(403);
  });
});
