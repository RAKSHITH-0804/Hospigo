import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { presetInput } from './print-template.rules';

prepareTestEnv();

type Cast = {
  h: KitHospital;
  admin: string; // SuperAdmin, hospital-wide, signed in at MAIN
  adminEast: string; // the same SuperAdmin signed in at EAST
  branchAdmin: string; // Branch Admin of MAIN only
  reception: string; // can read only
  nobody: string;
};

// A body that is valid for the receipt: a preset copied as it is (the same as the older spec does).
const bodyOf = (
  preset: string,
  docType: 'RECEIPT' | 'REGISTRATION_SLIP' | 'PRESCRIPTION' | 'PATIENT_REPORT',
) => JSON.parse(JSON.stringify(presetInput(preset, docType)));

describe('Print templates per branch (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let A: Cast;
  let B: Cast;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function seed(label: string, kit: ReturnType<typeof createKit>): Promise<Cast> {
    const h = await kit.hospital(label);
    // a hospital-wide holder of the template permissions (HQ's side of the work, as the tests stand in for it); a person who holds the permission for ONE
    // branch only stands for "changes only their own branch, never the hospital".
    const admin = await kit.person(h, 'sa', [h.main, h.east], {
      permissions: [
        'hospital.settings.read',
        'opd.settings.write',
        'print.templates.choose',
        'print.templates.manage',
      ],
      scope: 'HOSPITAL',
    });
    const branchAdmin = await kit.person(h, 'ba', [h.main], {
      permissions: ['hospital.settings.read', 'print.templates.manage'],
      scope: 'BRANCH',
    });
    const reception = await kit.person(h, 'recv', [h.main], {
      permissions: ['opd.visits.read'],
      scope: 'BRANCH',
    });
    const nobody = await kit.person(h, 'nobody', [h.main]);
    return {
      h,
      admin: admin.token(h.main),
      adminEast: admin.token(h.east),
      branchAdmin: branchAdmin.token(h.main),
      reception: reception.token(h.main),
      nobody: nobody.token(h.main),
    };
  }

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    const kit = createKit(owner, booted.tokens);
    A = await seed('A', kit);
    B = await seed('B', kit);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  /** Every test starts with no saved templates (the owner login may delete rows; the API may too). */
  beforeEach(async () => {
    for (const c of [A, B]) {
      await owner.printTemplate.deleteMany({ where: { tenantId: c.h.tenant } });
    }
  });

  const effective = async (token: string, docType = 'RECEIPT') =>
    (await http().get(`/print-templates/${docType}`).set(auth(token)).expect(200)).body;

  it('with nothing saved, every branch gets the built-in default (scope DEFAULT)', async () => {
    const res = await http().get('/print-templates').set(auth(A.admin)).expect(200);
    expect(res.body.items).toHaveLength(5);
    for (const item of res.body.items) {
      expect(item.scope).toBe('DEFAULT');
      expect(item.source).toBe('DEFAULT');
    }
  });

  it('lookup order: the branch own template, then the hospital, then the built-in default', async () => {
    // hospital-wide template (no scope given means the whole hospital, as before)
    await http()
      .put('/print-templates/RECEIPT')
      .set(auth(A.admin))
      .send(bodyOf('A4_FULL', 'RECEIPT'))
      .expect(200);
    expect((await effective(A.admin)).scope).toBe('HOSPITAL');
    expect((await effective(A.adminEast)).scope).toBe('HOSPITAL');
    // MAIN saves its own: MAIN uses it, EAST still uses the hospital's
    const own = await http()
      .put('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.admin))
      .send(bodyOf('LABEL_SLIP', 'RECEIPT'))
      .expect(200);
    expect(own.body.scope).toBe('BRANCH');
    expect(own.body.paper).toBe('LABEL');
    const main = await effective(A.admin);
    const east = await effective(A.adminEast);
    expect(main).toMatchObject({ scope: 'BRANCH', paper: 'LABEL' });
    expect(east).toMatchObject({ scope: 'HOSPITAL', paper: 'A4' });
    // the other documents are not touched
    expect((await effective(A.admin, 'PRESCRIPTION')).scope).toBe('DEFAULT');
    // resetting the branch falls back to the hospital's template, never to the default
    const reset = await http()
      .delete('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.admin))
      .expect(200);
    expect(reset.body).toMatchObject({ scope: 'HOSPITAL', paper: 'A4' });
    // resetting the hospital's falls back to the built-in default
    const wide = await http()
      .delete('/print-templates/RECEIPT?scope=hospital')
      .set(auth(A.admin))
      .expect(200);
    expect(wide.body.scope).toBe('DEFAULT');
  });

  it('the branch always comes from the token: another branch is never touched or shown', async () => {
    await http()
      .put('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.adminEast))
      .send(bodyOf('LABEL_SLIP', 'RECEIPT'))
      .expect(200);
    const rows = await owner.printTemplate.findMany({ where: { tenantId: A.h.tenant } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.branchId).toBe(A.h.east);
    // a branch id in the query or body is not accepted as a way to pick a branch
    await http()
      .put(`/print-templates/RECEIPT?scope=${A.h.main}`)
      .set(auth(A.admin))
      .send(bodyOf('A4_FULL', 'RECEIPT'))
      .expect(400);
    expect((await effective(A.admin)).scope).toBe('DEFAULT');
    expect((await effective(A.adminEast)).scope).toBe('BRANCH');
  });

  it('a Branch Admin changes only their own branch, never the hospital-wide template', async () => {
    // MAIN has an EAST sibling, so a Branch Admin of MAIN is not hospital-wide
    await http()
      .put('/print-templates/RECEIPT?scope=hospital')
      .set(auth(A.branchAdmin))
      .send(bodyOf('A4_FULL', 'RECEIPT'))
      .expect(403)
      .expect((res) => expect(res.body.code).toBe('PRINT_SCOPE_FORBIDDEN'));
    // no scope means hospital: refused the same way
    await http()
      .put('/print-templates/RECEIPT')
      .set(auth(A.branchAdmin))
      .send(bodyOf('A4_FULL', 'RECEIPT'))
      .expect(403);
    await http()
      .delete('/print-templates/RECEIPT?scope=hospital')
      .set(auth(A.branchAdmin))
      .expect(403);
    expect(await owner.printTemplate.count({ where: { tenantId: A.h.tenant } })).toBe(0);
    // their own branch works
    const ok = await http()
      .put('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.branchAdmin))
      .send(bodyOf('A5_FULL', 'RECEIPT'))
      .expect(200);
    expect(ok.body.scope).toBe('BRANCH');
    const row = await owner.printTemplate.findFirstOrThrow({ where: { tenantId: A.h.tenant } });
    expect(row.branchId).toBe(A.h.main);
    // and the hospital-wide template stays out of their reach even when it exists
    await http()
      .put('/print-templates/PRESCRIPTION?scope=hospital')
      .set(auth(A.admin))
      .send(bodyOf('A4_FULL', 'PRESCRIPTION'))
      .expect(200);
    await http()
      .delete('/print-templates/PRESCRIPTION?scope=hospital')
      .set(auth(A.branchAdmin))
      .expect(403);
    expect((await effective(A.branchAdmin, 'PRESCRIPTION')).scope).toBe('HOSPITAL');
    // list tells the screen what this person may change
    const list = await http().get('/print-templates').set(auth(A.branchAdmin)).expect(200);
    expect(list.body.canChange).toEqual({ branch: true, hospital: false });
    const wide = await http().get('/print-templates').set(auth(A.admin)).expect(200);
    expect(wide.body.canChange).toEqual({ branch: true, hospital: true });
  });

  it('deny by default: a reader or a person with no role cannot save or reset in any scope', async () => {
    for (const scope of ['branch', 'hospital']) {
      for (const token of [A.reception, A.nobody]) {
        await http()
          .put(`/print-templates/RECEIPT?scope=${scope}`)
          .set(auth(token))
          .send(bodyOf('A4_FULL', 'RECEIPT'))
          .expect(403);
        await http().delete(`/print-templates/RECEIPT?scope=${scope}`).set(auth(token)).expect(403);
      }
    }
    expect(await owner.printTemplate.count({ where: { tenantId: A.h.tenant } })).toBe(0);
    // but every signed-in staff member can read what applies to their branch
    await http().get('/print-templates').set(auth(A.reception)).expect(200);
    const list = await http().get('/print-templates').set(auth(A.reception)).expect(200);
    expect(list.body.canChange).toEqual({ branch: false, hospital: false });
  });

  it('a bad scope is a clean 400 and nothing is saved', async () => {
    for (const scope of ['all', 'BRANCH', '1', 'branch,hospital']) {
      const res = await http()
        .put(`/print-templates/RECEIPT?scope=${encodeURIComponent(scope)}`)
        .set(auth(A.admin))
        .send(bodyOf('A4_FULL', 'RECEIPT'))
        .expect(400);
      expect(res.body.code).toBe('PRINT_SCOPE_INVALID');
    }
    await http()
      .put('/print-templates/RECEIPT?scope=branch&scope=hospital')
      .set(auth(A.admin))
      .send(bodyOf('A4_FULL', 'RECEIPT'))
      .expect(400);
    expect(await owner.printTemplate.count({ where: { tenantId: A.h.tenant } })).toBe(0);
  });

  it('a branch template is validated like any other (the receipt token rule still holds)', async () => {
    const bad = bodyOf('A4_FULL', 'RECEIPT');
    bad.paper = 'NOT_A_PAPER';
    const res = await http()
      .put('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.admin))
      .send(bad)
      .expect(400);
    expect(res.body.code).toBe('PRINT_TEMPLATE_INVALID');
    expect(await owner.printTemplate.count({ where: { tenantId: A.h.tenant } })).toBe(0);
  });

  it('two first saves of the same branch at the same moment: both succeed, one row', async () => {
    const [a, b] = await Promise.all([
      http()
        .put('/print-templates/RECEIPT?scope=branch')
        .set(auth(A.admin))
        .send(bodyOf('A4_FULL', 'RECEIPT')),
      http()
        .put('/print-templates/RECEIPT?scope=branch')
        .set(auth(A.admin))
        .send(bodyOf('A5_FULL', 'RECEIPT')),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(
      await owner.printTemplate.count({ where: { tenantId: A.h.tenant, branchId: A.h.main } }),
    ).toBe(1);
  });

  it('audit holds the scope and the names of what changed, never the texts', async () => {
    // the audit log is never deleted, so earlier tests left rows: look only at the new ones
    const seen = await owner.auditLog.count({
      where: { tenantId: A.h.tenant, entityType: 'print_template' },
    });
    await http()
      .put('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.admin))
      .send(bodyOf('LABEL_SLIP', 'RECEIPT'))
      .expect(200);
    await http().delete('/print-templates/RECEIPT?scope=branch').set(auth(A.admin)).expect(200);
    const logs = await owner.auditLog.findMany({
      where: { tenantId: A.h.tenant, entityType: 'print_template' },
      orderBy: { createdAt: 'asc' },
      skip: seen,
    });
    expect(logs.map((l) => l.action)).toEqual(['PRINT_TEMPLATE_UPDATE', 'PRINT_TEMPLATE_RESET']);
    expect(logs[0]!.metadata).toMatchObject({ docType: 'RECEIPT', scope: 'branch', created: true });
    expect(logs[1]!.metadata).toEqual({ docType: 'RECEIPT', scope: 'branch' });
  });

  it('hospitals stay apart: a branch template of one hospital never shows in another', async () => {
    await http()
      .put('/print-templates/RECEIPT?scope=branch')
      .set(auth(A.admin))
      .send(bodyOf('LABEL_SLIP', 'RECEIPT'))
      .expect(200);
    expect((await effective(B.admin)).scope).toBe('DEFAULT');
    expect(await owner.printTemplate.count({ where: { tenantId: B.h.tenant } })).toBe(0);
    // resetting in B changes nothing in A
    await http().delete('/print-templates/RECEIPT?scope=branch').set(auth(B.admin)).expect(200);
    expect((await effective(A.admin)).scope).toBe('BRANCH');
  });
  describe('Step 2.1a: default paper, separate documents, retired templates', () => {
    it('a hospital that chooses A4 as its default paper gets A4 defaults (the patient card stays a label), and A5 is the default', async () => {
      const before = await http().get('/print-templates').set(auth(A.admin)).expect(200);
      expect(
        Object.fromEntries(
          before.body.items.map((i: { docType: string; paper: string }) => [i.docType, i.paper]),
        ),
      ).toEqual({
        REGISTRATION_SLIP: 'A5',
        RECEIPT: 'A5',
        PRESCRIPTION: 'A5',
        PATIENT_REPORT: 'A5',
        PATIENT_CARD: 'LABEL',
      });
      await http()
        .put('/settings/opd-rules')
        .set(auth(A.admin))
        .send({ defaultPrintPaper: 'A4' })
        .expect(200);
      try {
        const after = await http().get('/print-templates').set(auth(A.admin)).expect(200);
        expect(
          Object.fromEntries(
            after.body.items.map((i: { docType: string; paper: string }) => [i.docType, i.paper]),
          ),
        ).toEqual({
          REGISTRATION_SLIP: 'A4',
          RECEIPT: 'A4',
          PRESCRIPTION: 'A4',
          PATIENT_REPORT: 'A4',
          PATIENT_CARD: 'LABEL',
        });
        // saved templates are untouched by the setting
        await http()
          .put('/print-templates/RECEIPT')
          .set(auth(A.admin))
          .send(bodyOf('A5_FULL', 'RECEIPT'))
          .expect(200);
        expect((await effective(A.admin)).paper).toBe('A5');
        // a wrong value is refused
        const bad = await http()
          .put('/settings/opd-rules')
          .set(auth(A.admin))
          .send({ defaultPrintPaper: 'LABEL' });
        expect(bad.status).toBe(400);
      } finally {
        await http()
          .put('/settings/opd-rules')
          .set(auth(A.admin))
          .send({ defaultPrintPaper: 'A5', patientCardAutoPrint: false })
          .expect(200);
      }
    });

    it('the patient card automatic print is OFF by default and is a hospital setting', async () => {
      const rules = await http().get('/settings/opd-rules').set(auth(A.admin)).expect(200);
      expect(rules.body.patientCardAutoPrint).toBe(false);
      expect(rules.body.defaultPrintPaper).toBe('A5');
      const on = await http()
        .put('/settings/opd-rules')
        .set(auth(A.admin))
        .send({ patientCardAutoPrint: true })
        .expect(200);
      expect(on.body.patientCardAutoPrint).toBe(true);
      expect(
        (
          await http()
            .put('/settings/opd-rules')
            .set(auth(A.admin))
            .send({ patientCardAutoPrint: 'yes' })
        ).status,
      ).toBe(400);
      await http()
        .put('/settings/opd-rules')
        .set(auth(A.admin))
        .send({ patientCardAutoPrint: false })
        .expect(200);
    });

    it('the prescription and the patient report are different documents with their own fields', async () => {
      const rx = (await effective(A.admin, 'PRESCRIPTION')).layout.elements
        .flatMap((e: { content?: { paragraphs: Array<{ runs: Array<{ field?: string }> }> } }) =>
          (e.content?.paragraphs ?? []).flatMap((p) => p.runs.map((r) => r.field)),
        )
        .filter(Boolean);
      expect(rx).toEqual(expect.arrayContaining(['patientName', 'medicines', 'doctorSignature']));
      for (const never of [
        'vitals',
        'diagnosis',
        'tests',
        'advice',
        'complaints',
        'receptionSymptoms',
      ]) {
        expect(rx).not.toContain(never);
      }
      // a layout of the report is refused as a prescription (no vitals boxes on the slim document)
      const refused = await http()
        .put('/print-templates/PRESCRIPTION')
        .set(auth(A.admin))
        .send(bodyOf('A5_FULL', 'PATIENT_REPORT'));
      expect(refused.status).toBe(400);
      expect(refused.body.reason).toBe('UNKNOWN_FIELD');
      expect(await owner.printTemplate.count({ where: { tenantId: A.h.tenant } })).toBe(0);
    });

    it('a retired template is never read, and does not block a new template of the same document', async () => {
      const admin = await owner.user.findFirstOrThrow({
        where: { tenantId: A.h.tenant },
        select: { id: true },
      });
      const base = presetInput('A4_FULL', 'RECEIPT');
      await owner.printTemplate.create({
        data: {
          tenantId: A.h.tenant,
          docType: 'PRESCRIPTION',
          paper: 'A4',
          layout: JSON.parse(JSON.stringify(base.layout)),
          createdBy: admin.id,
          updatedBy: admin.id,
          retiredAt: new Date(),
        },
      });
      expect((await effective(A.admin, 'PRESCRIPTION')).scope).toBe('DEFAULT');
      await http()
        .put('/print-templates/PRESCRIPTION')
        .set(auth(A.admin))
        .send(bodyOf('A5_FULL', 'PRESCRIPTION'))
        .expect(200);
      expect((await effective(A.admin, 'PRESCRIPTION')).scope).toBe('HOSPITAL');
      const rows = await owner.printTemplate.findMany({
        where: { tenantId: A.h.tenant, docType: 'PRESCRIPTION' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.retiredAt === null)).toHaveLength(1);
      // a reset removes only the live one
      await http().delete('/print-templates/PRESCRIPTION').set(auth(A.admin)).expect(200);
      expect(
        await owner.printTemplate.count({
          where: { tenantId: A.h.tenant, docType: 'PRESCRIPTION' },
        }),
      ).toBe(1);
    });
  });
});
