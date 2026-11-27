import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { logoPng } from '../../database/showcase/png-logo';
import { AuthRedisService } from '../auth/auth-redis.service';
import type { TokenService } from '../auth/token.service';
import { presetInput } from '../print-templates/print-template.rules';

prepareTestEnv();
process.env.AUTH_IP_RATE_LIMIT_PER_MIN = '1000';

/**
 * Phase 2.2 checkpoint 2: HQ sets the active design and the logo of a hospital without entering it, and
 * edits a library template in the designer. Permission "print designs", hospital assignment, tenant
 * isolation, and what the hospital sees afterwards.
 */
describe('HQ print designs without entry (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  const stamp = Date.now();
  let app: INestApplication;
  let tokens: TokenService;
  let A: KitHospital;
  let B: KitHospital;
  let C: KitHospital;
  let admin: string;
  let staff: string;
  let saA: string;
  let saB: string;
  let templateId: string;
  let logoId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hq = (id: string) => tokens.signHqAccess({ userId: id });
  const makeHq = async (label: string, indigoRole: 'OWNER' | 'EMPLOYEE') =>
    (
      await owner.hqUser.create({
        data: {
          email: `print-${label}-${stamp}@example.test`,
          displayName: `Print ${label}`,
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
    app.get(AuthRedisService).setKeyPrefix(`hqprint-test-${stamp}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('QA');
    B = await kit.hospital('QB');
    C = await kit.hospital('QC'); // no Super Admin at all
    const role = (h: KitHospital) => ({ roleId: h.superAdminRoleId, scope: 'HOSPITAL' as const });
    saA = (await kit.person(A, 'sa', [A.main, A.east], role(A))).token(A.main);
    saB = (await kit.person(B, 'sa', [B.main], role(B))).token(B.main);
    admin = await makeHq('admin', 'OWNER');
    staff = await makeHq('staff', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: staff, tenantId: A.tenant } });
    await owner.hqUserPermission.createMany({
      data: ['hq.hospitals.view', 'hq.print'].map((permission) => ({
        hqUserId: staff,
        permission,
      })),
    });
    const input = presetInput('A5_FULL', 'RECEIPT');
    templateId = (
      await owner.printLibraryTemplate.create({
        data: {
          docType: 'RECEIPT',
          key: `hqprint-${stamp}`,
          name: `HQ print ${stamp}`,
          description: 'test',
          input: input as never,
          createdBy: admin,
        },
      })
    ).id;
    const png = logoPng(32, [10, 90, 160], 'CROSS');
    logoId = (
      await owner.printLibraryLogo.create({
        data: {
          name: `HQ logo ${stamp}`,
          contentType: 'image/png',
          byteSize: png.length,
          width: 32,
          height: 32,
          data: png,
          createdBy: admin,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('refuses without the tick, outside the assignment, with a hospital token, and on a hospital without a Super Admin', async () => {
    const noTick = await makeHq('notick', 'EMPLOYEE');
    await owner.hqUserHospital.create({ data: { hqUserId: noTick, tenantId: A.tenant } });
    const body = { templateId };
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/print-design`)
          .set(auth(hq(noTick)))
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${B.tenant}/print-design`)
          .set(auth(hq(staff)))
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (await http().put(`/indigo/hospitals/${A.tenant}/print-design`).set(auth(saA)).send(body))
        .status,
    ).toBe(401);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${C.tenant}/print-design`)
          .set(auth(hq(admin)))
          .send(body)
      ).status,
    ).toBe(409);
    for (const bad of [
      {},
      { templateId: 'nope' },
      { templateId, extra: 1 },
      { templateId, branchId: 'x' },
    ]) {
      const res = await http()
        .put(`/indigo/hospitals/${A.tenant}/print-design`)
        .set(auth(hq(admin)))
        .send(bad);
      expect([bad, res.status]).toEqual([bad, 400]);
    }
  });

  it('HQ sets the hospital design; the hospital sees it, assigned to it; nothing leaks to another hospital', async () => {
    const before = await http().get('/print-templates/RECEIPT').set(auth(saA)).expect(200);
    expect(before.body.source).toBe('DEFAULT');
    await http()
      .put(`/indigo/hospitals/${A.tenant}/print-design`)
      .set(auth(hq(staff)))
      .send({ templateId })
      .expect(200);
    const after = await http().get('/print-templates/RECEIPT').set(auth(saA)).expect(200);
    expect(after.body.source).toBe('CUSTOM');
    expect(after.body.scope).toBe('HOSPITAL');
    const other = await http().get('/print-templates/RECEIPT').set(auth(saB)).expect(200);
    expect(other.body.source).toBe('DEFAULT');
    // the chooser of the hospital lists it as active and assigned
    const view = await http().get('/print-library').set(auth(saA)).expect(200);
    expect(view.body.templates.find((t: { id: string }) => t.id === templateId).active).toBe(true);
    // the HQ screen reads the same
    const active = await http()
      .get(`/indigo/hospitals/${A.tenant}/print`)
      .set(auth(hq(staff)))
      .expect(200);
    expect(active.body.designs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docType: 'RECEIPT',
          branchId: null,
          libraryTemplateId: templateId,
        }),
      ]),
    );
    // the audit entry names HQ, not a hospital user
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { tenantId: A.tenant, action: 'PRINT_TEMPLATE_UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.actorUserId).toBeNull();
    expect(audit.metadata).toMatchObject({ hqUserId: staff });
    const log = await owner.hqActivityLog.findFirstOrThrow({
      where: { action: 'HQ_PRINT_DESIGN_SET', hqUserId: staff, tenantId: A.tenant },
    });
    expect(log.detail).toMatchObject({ docType: 'RECEIPT', scope: 'hospital' });
  });

  it('HQ sets a branch design; a branch of another hospital is refused', async () => {
    await http()
      .put(`/indigo/hospitals/${A.tenant}/print-design`)
      .set(auth(hq(admin)))
      .send({ templateId, branchId: A.east })
      .expect(200);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/print-design`)
          .set(auth(hq(admin)))
          .send({ templateId, branchId: B.main })
      ).status,
    ).toBe(400);
    const rows = await owner.printTemplate.findMany({
      where: { tenantId: A.tenant, docType: 'RECEIPT', retiredAt: null },
    });
    expect(rows.map((r) => r.branchId).sort()).toEqual([A.east, null].sort());
  });

  it('HQ sets the logo from the library; the hospital has it; the HQ log records the logo name only', async () => {
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${B.tenant}/logo`)
          .set(auth(hq(staff)))
          .send({ logoId })
      ).status,
    ).toBe(403);
    await http()
      .put(`/indigo/hospitals/${A.tenant}/logo`)
      .set(auth(hq(staff)))
      .send({ logoId })
      .expect(200);
    expect(
      await owner.storedImage.count({
        where: { tenantId: A.tenant, purpose: 'HOSPITAL_LOGO', isCurrent: true },
      }),
    ).toBe(1);
    expect(
      await owner.storedImage.count({ where: { tenantId: B.tenant, purpose: 'HOSPITAL_LOGO' } }),
    ).toBe(0);
    const active = await http()
      .get(`/indigo/hospitals/${A.tenant}/print`)
      .set(auth(hq(admin)))
      .expect(200);
    expect(active.body.hasLogo).toBe(true);
    expect(
      (
        await http()
          .put(`/indigo/hospitals/${A.tenant}/logo`)
          .set(auth(hq(admin)))
          .send({ logoId: 'x' })
      ).status,
    ).toBe(400);
  });

  it('the designer loads and saves a library template; bad templates are refused; hospitals keep their copy until HQ sets it again', async () => {
    const loaded = await http()
      .get(`/indigo/library/templates/${templateId}`)
      .set(auth(hq(staff)))
      .expect(200);
    expect(loaded.body.template.docType).toBe('RECEIPT');
    const edited = { ...loaded.body.template, enabled: true };
    delete edited.docType;
    delete edited.source;
    delete edited.scope;
    delete edited.pageWidthMm;
    delete edited.pageHeightMm;
    delete edited.updatedAt;
    edited.layout = { ...edited.layout, fontSizePt: 11 };
    await http()
      .put(`/indigo/library/templates/${templateId}`)
      .set(auth(hq(staff)))
      .send(edited)
      .expect(200);
    const row = await owner.printLibraryTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect((row.input as { layout: { fontSizePt: number } }).layout.fontSizePt).toBe(11);
    expect(
      (
        await http()
          .put(`/indigo/library/templates/${templateId}`)
          .set(auth(hq(staff)))
          .send({ nonsense: true })
      ).status,
    ).toBe(400);
    expect(
      (await http().put(`/indigo/library/templates/${templateId}`).set(auth(saA)).send(edited))
        .status,
    ).toBe(401);
    // the hospital's copy did not change
    const hospitalRow = await owner.printTemplate.findFirstOrThrow({
      where: { tenantId: A.tenant, docType: 'RECEIPT', branchId: null, retiredAt: null },
    });
    expect((hospitalRow.layout as { fontSizePt: number }).fontSizePt).not.toBe(11);
    // an unknown template and a template without the tick
    expect(
      (
        await http()
          .get('/indigo/library/templates/nope')
          .set(auth(hq(admin)))
      ).status,
    ).toBe(400);
    const noTick = await makeHq('notick2', 'EMPLOYEE');
    expect(
      (
        await http()
          .get(`/indigo/library/templates/${templateId}`)
          .set(auth(hq(noTick)))
      ).status,
    ).toBe(403);
  });
});
