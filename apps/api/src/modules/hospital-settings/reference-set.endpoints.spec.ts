import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';

prepareTestEnv();

type Cast = { h: KitHospital; admin: string; nobody: string };

describe('Reference field set on the registration form (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let kit: ReturnType<typeof createKit>;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function seed(label: string): Promise<Cast> {
    const h = await kit.hospital(label);
    const cast = await kit.cast(h);
    return { h, admin: cast.admin, nobody: cast.nobody };
  }

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    kit = createKit(owner, booted.tokens);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  const add = (c: Cast) => http().post('/settings/patient-fields/reference-set').set(auth(c.admin));
  const customLabels = async (c: Cast) =>
    (
      await owner.patientCustomField.findMany({
        where: { tenantId: c.h.tenant },
        orderBy: { label: 'asc' },
      })
    ).map((f) => f.label);

  it('needs a token (401) and the settings permission (403)', async () => {
    const A = await seed('PERM');
    await http().post('/settings/patient-fields/reference-set').expect(401);
    await http().post('/settings/patient-fields/reference-set').set(auth(A.nobody)).expect(403);
    expect(await customLabels(A)).toEqual([]);
  });

  it('adds Referred by, Category (with its choices), Organisation and Staff number, on the form and not required', async () => {
    const A = await seed('ADD');
    const res = await add(A).expect(200);
    expect(res.body).toEqual({
      created: ['Referred by', 'Category', 'Organisation', 'Staff number'],
      kept: [],
      skipped: [],
    });
    expect(await customLabels(A)).toEqual([
      'Category',
      'Organisation',
      'Referred by',
      'Staff number',
    ]);
    const category = await owner.patientCustomField.findFirstOrThrow({
      where: { tenantId: A.h.tenant, label: 'Category' },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(category.dataType).toBe('DROPDOWN');
    expect(category.options.map((o) => o.label)).toEqual([
      'General',
      'Staff',
      'Insurance',
      'Senior citizen',
    ]);
    const form = await http().get('/settings/patient-fields').set(auth(A.admin)).expect(200);
    const onForm = (
      form.body.custom as Array<{ label: string; isEnabled: boolean; isRequired: boolean }>
    ).filter((f) => ['Referred by', 'Category', 'Organisation', 'Staff number'].includes(f.label));
    expect(onForm).toHaveLength(4);
    expect(onForm.every((f) => f.isEnabled && !f.isRequired)).toBe(true);
    // the audit trail has field names, never what was typed
    const audits = await owner.auditLog.findMany({
      where: { tenantId: A.h.tenant, entityType: 'patient_custom_fields' },
    });
    expect(audits).toHaveLength(4);
  });

  it('pressing it again, or twice at the same moment, adds each field once', async () => {
    const A = await seed('TWICE');
    const results = await Promise.all([add(A), add(A)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const all = results.flatMap((r) => [...r.body.created, ...r.body.kept]);
    expect(all.sort()).toEqual([
      'Category',
      'Category',
      'Organisation',
      'Organisation',
      'Referred by',
      'Referred by',
      'Staff number',
      'Staff number',
    ]);
    expect(await customLabels(A)).toEqual([
      'Category',
      'Organisation',
      'Referred by',
      'Staff number',
    ]);
    const third = await add(A).expect(200);
    expect(third.body.created).toEqual([]);
    expect(third.body.kept).toHaveLength(4);
  });

  it('a field the hospital already has (same name, any letters) is left exactly as it is', async () => {
    const A = await seed('KEEP');
    const mine = await http()
      .post('/settings/patient-fields/custom')
      .set(auth(A.admin))
      .send({ label: 'staff NUMBER', dataType: 'NUMBER', section: 'CONTACT', isRequired: true })
      .expect(201);
    const res = await add(A).expect(200);
    expect(res.body.kept).toEqual(['Staff number']);
    expect(res.body.created).toEqual(['Referred by', 'Category', 'Organisation']);
    const after = await owner.patientCustomField.findUniqueOrThrow({ where: { id: mine.body.id } });
    expect(after).toMatchObject({ label: 'staff NUMBER', dataType: 'NUMBER', section: 'CONTACT' });
    const setting = await owner.patientFieldSetting.findFirstOrThrow({
      where: { tenantId: A.h.tenant, customFieldId: mine.body.id },
    });
    expect(setting.isRequired).toBe(true);
  });

  it('stops at the limit of custom fields and says which were skipped', async () => {
    const A = await seed('FULL');
    await owner.patientCustomField.createMany({
      data: Array.from({ length: 29 }, (_, i) => ({
        tenantId: A.h.tenant,
        code: `cf_x${i}`,
        label: `Own field ${i}`,
        dataType: 'TEXT' as const,
        section: 'OTHER' as const,
      })),
    });
    const res = await add(A).expect(200);
    expect(res.body.created).toEqual(['Referred by']);
    expect(res.body.skipped).toEqual(['Category', 'Organisation', 'Staff number']);
    expect(await owner.patientCustomField.count({ where: { tenantId: A.h.tenant } })).toBe(30);
  });

  it("another hospital's form is never touched", async () => {
    const A = await seed('ISO_A');
    const B = await seed('ISO_B');
    await add(A).expect(200);
    expect(await customLabels(B)).toEqual([]);
    await add(B).expect(200);
    expect(await customLabels(A)).toEqual([
      'Category',
      'Organisation',
      'Referred by',
      'Staff number',
    ]);
    expect(await customLabels(B)).toEqual([
      'Category',
      'Organisation',
      'Referred by',
      'Staff number',
    ]);
  });
});
