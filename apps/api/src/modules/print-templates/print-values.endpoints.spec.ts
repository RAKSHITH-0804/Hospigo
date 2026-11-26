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
  owner: string; // Indigo Owner at MAIN (changes templates)
  admin: string; // SuperAdmin at MAIN
  adminEast: string; // the same SuperAdmin at EAST
  branchAdmin: string; // Branch Admin of MAIN
  reception: string;
  nobody: string;
};

describe('Extra print values (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let A: Cast;
  let B: Cast;
  let keySeq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** Values are never deleted, so every test uses keys of its own. */
  const key = (name: string) => `${name}_${Date.now().toString(36)}${(keySeq += 1)}`.slice(0, 30);

  async function seed(label: string, kit: ReturnType<typeof createKit>): Promise<Cast> {
    const h = await kit.hospital(label);
    const admin = await kit.person(h, 'sa', [h.main, h.east], {
      roleId: h.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    const branchAdmin = await kit.person(h, 'ba', [h.main], {
      roleId: h.branchAdminRoleId,
      scope: 'BRANCH',
    });
    const reception = await kit.person(h, 'recv', [h.main], {
      permissions: ['opd.visits.read'],
      scope: 'BRANCH',
    });
    const nobody = await kit.person(h, 'nobody', [h.main]);
    const indigoOwner = await kit.person(h, 'owner', [h.main, h.east], {
      roleId: h.ownerRoleId,
      scope: 'HOSPITAL',
    });
    return {
      h,
      owner: indigoOwner.token(h.main),
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

  const add = (token: string, body: unknown, scope?: string) =>
    http()
      .post(`/print-values${scope ? `?scope=${scope}` : ''}`)
      .set(auth(token))
      .send(body as object);
  const effective = async (token: string) =>
    (await http().get('/print-values').set(auth(token)).expect(200)).body.items as {
      key: string;
      field: string;
      label: string;
      text: string;
    }[];
  const textOf = (items: { key: string; text: string }[], k: string) =>
    items.find((i) => i.key === k)?.text;

  // ------------------------------------------------------------------ access

  it('401 without a token; reading needs only a signed-in person; everything else needs the settings permission', async () => {
    await http().get('/print-values').expect(401);
    await http().get('/print-values/manage').expect(401);
    await http().get('/print-values').set(auth(A.reception)).expect(200);
    await http().get('/print-values').set(auth(A.nobody)).expect(200);
    const k = key('acc');
    for (const token of [A.reception, A.nobody]) {
      await add(token, { key: k, label: 'X', value: 'y' }).expect(403);
      await add(token, { key: k, label: 'X', value: 'y' }, 'branch').expect(403);
      await http().get('/print-values/manage').set(auth(token)).expect(403);
    }
    expect(await owner.printValue.count({ where: { tenantId: A.h.tenant, key: k } })).toBe(0);
  });

  // ------------------------------------------------------------------ add, read, change

  it('adds a hospital value and a branch value; reads show only what applies to the branch', async () => {
    const wide = key('helpline');
    const east = key('eastonly');
    const made = await add(A.admin, { key: wide, label: 'Helpline', value: '1800 000 000' }).expect(
      201,
    );
    expect(made.body).toMatchObject({
      key: wide,
      field: `value.${wide}`,
      label: 'Helpline',
      value: '1800 000 000',
      active: true,
      scope: 'HOSPITAL',
    });
    await add(A.adminEast, { key: east, label: 'East note', value: 'East wing' }, 'branch').expect(
      201,
    );
    // MAIN sees the hospital value but never the EAST value
    const main = await effective(A.admin);
    expect(textOf(main, wide)).toBe('1800 000 000');
    expect(textOf(main, east)).toBeUndefined();
    // EAST sees both
    const eastItems = await effective(A.adminEast);
    expect(textOf(eastItems, wide)).toBe('1800 000 000');
    expect(textOf(eastItems, east)).toBe('East wing');
    // every signed-in person gets the same view for their branch
    expect(textOf(await effective(A.reception), wide)).toBe('1800 000 000');
  });

  it('a branch value with the same key replaces the hospital value for that branch only', async () => {
    const k = key('nabh');
    await add(A.admin, { key: k, label: 'NABH number', value: 'HOSP-1' }).expect(201);
    await add(A.adminEast, { key: k, label: 'NABH number', value: 'EAST-9' }, 'branch').expect(201);
    expect(textOf(await effective(A.admin), k)).toBe('HOSP-1');
    expect(textOf(await effective(A.adminEast), k)).toBe('EAST-9');
    // a switched-off branch value hides the hospital value for that branch (and no other)
    const manage = await http().get('/print-values/manage').set(auth(A.adminEast)).expect(200);
    const branchRow = manage.body.items.find(
      (i: { key: string; scope: string }) => i.key === k && i.scope === 'BRANCH',
    );
    await http()
      .put(`/print-values/${branchRow.id}`)
      .set(auth(A.adminEast))
      .send({ active: false })
      .expect(200);
    expect(textOf(await effective(A.adminEast), k)).toBeUndefined();
    expect(textOf(await effective(A.admin), k)).toBe('HOSP-1');
  });

  it('the same key twice in one scope is a 409, also when two requests arrive together; the limit holds', async () => {
    const k = key('dup');
    await add(A.admin, { key: k, label: 'One', value: 'a' }).expect(201);
    const again = await add(A.admin, { key: k, label: 'Two', value: 'b' }).expect(409);
    expect(again.body).toMatchObject({ code: 'PRINT_VALUE_CONFLICT', reason: 'KEY_EXISTS' });
    const k2 = key('race');
    const calls = await Promise.all([
      add(A.admin, { key: k2, label: 'R1', value: 'a' }),
      add(A.admin, { key: k2, label: 'R2', value: 'b' }),
    ]);
    expect(calls.map((c) => c.status).sort()).toEqual([201, 409]);
    expect(await owner.printValue.count({ where: { tenantId: A.h.tenant, key: k2 } })).toBe(1);
    // the limit per scope: fill the EAST scope of hospital B, then one more is refused
    const have = await owner.printValue.count({
      where: { tenantId: B.h.tenant, branchId: B.h.east },
    });
    for (let i = have; i < 30; i += 1) {
      await add(B.adminEast, { key: `fill_${i}`, label: `Fill ${i}`, value: 'v' }, 'branch').expect(
        201,
      );
    }
    const over = await add(
      B.adminEast,
      { key: 'one_too_many', label: 'x', value: 'v' },
      'branch',
    ).expect(409);
    expect(over.body.reason).toBe('TOO_MANY');
  });

  it('change label, text, and switch off and on; nothing else; audit names only', async () => {
    const k = key('chg');
    const made = (await add(A.admin, { key: k, label: 'Before', value: 'one' }).expect(201)).body;
    const seen = await owner.auditLog.count({
      where: { tenantId: A.h.tenant, entityType: 'print_value', entityId: made.id },
    });
    const changed = await http()
      .put(`/print-values/${made.id}`)
      .set(auth(A.admin))
      .send({ label: 'After', value: 'two' })
      .expect(200);
    expect(changed.body).toMatchObject({ label: 'After', value: 'two', key: k });
    await http()
      .put(`/print-values/${made.id}`)
      .set(auth(A.admin))
      .send({ active: false })
      .expect(200);
    expect(textOf(await effective(A.admin), k)).toBeUndefined();
    await http()
      .put(`/print-values/${made.id}`)
      .set(auth(A.admin))
      .send({ active: true })
      .expect(200);
    expect(textOf(await effective(A.admin), k)).toBe('two');
    // a change that changes nothing is not audited
    await http()
      .put(`/print-values/${made.id}`)
      .set(auth(A.admin))
      .send({ label: 'After' })
      .expect(200);
    const logs = await owner.auditLog.findMany({
      where: { tenantId: A.h.tenant, entityType: 'print_value', entityId: made.id },
      orderBy: { createdAt: 'asc' },
      skip: 0,
    });
    expect(logs).toHaveLength(seen + 3);
    const meta = logs.map((l) => l.metadata as Record<string, unknown>);
    expect(meta[0]).toEqual({ kind: 'ADD', key: k, scope: 'HOSPITAL' });
    expect(meta[1]).toEqual({
      kind: 'CHANGE',
      key: k,
      scope: 'HOSPITAL',
      changed: ['label', 'value'],
    });
    expect(meta[2]).toEqual({ kind: 'CHANGE', key: k, scope: 'HOSPITAL', changed: ['active'] });
    // no typed text anywhere in the audit
    expect(JSON.stringify(meta)).not.toMatch(/After|Before|one|two/);
  });

  // ------------------------------------------------------------------ plain text only

  it('refuses anything that is not plain text, a bad key, unknown fields, empty and too long values', async () => {
    const bad = async (body: unknown, reason: string, field?: string) => {
      const res = await add(A.admin, body).expect(400);
      expect(res.body.code).toBe('PRINT_VALUE_INVALID');
      expect(res.body.reason).toBe(reason);
      if (field) {
        expect(res.body.field).toBe(field);
      }
    };
    const k = key('bad');
    await bad(
      { key: k, label: 'L', value: '<script>alert(1)</script>' },
      'NOT_PLAIN_TEXT',
      'value',
    );
    await bad({ key: k, label: '<b>L</b>', value: 'v' }, 'NOT_PLAIN_TEXT', 'label');
    await bad({ key: k, label: 'L', value: 'line one\nline two' }, 'NOT_PLAIN_TEXT', 'value');
    await bad({ key: k, label: 'L', value: 'tab\there' }, 'NOT_PLAIN_TEXT', 'value');
    await bad({ key: k, label: 'L', value: 'abc\u202Edef' }, 'NOT_PLAIN_TEXT', 'value');
    await bad({ key: k, label: 'zero\u200Bwidth', value: 'v' }, 'NOT_PLAIN_TEXT', 'label');
    await bad({ key: k, label: 'L', value: '   ' }, 'REQUIRED', 'value');
    await bad({ key: k, label: 'L', value: 'x'.repeat(201) }, 'TOO_LONG', 'value');
    await bad({ key: k, label: 'x'.repeat(61), value: 'v' }, 'TOO_LONG', 'label');
    await bad({ key: 'Has Space', label: 'L', value: 'v' }, 'KEY_INVALID', 'key');
    await bad({ key: '1abc', label: 'L', value: 'v' }, 'KEY_INVALID', 'key');
    await bad({ key: 'UPPER', label: 'L', value: 'v' }, 'KEY_INVALID', 'key');
    await bad({ key: 'x'.repeat(31), label: 'L', value: 'v' }, 'KEY_INVALID', 'key');
    await bad({ key: k, label: 'L', value: 'v', html: true }, 'UNKNOWN_FIELD', 'html');
    await bad(
      { key: k, label: 'L', value: 'v', tenantId: B.h.tenant },
      'UNKNOWN_FIELD',
      'tenantId',
    );
    await bad({ key: k, label: 'L', value: 'v', branchId: B.h.main }, 'UNKNOWN_FIELD', 'branchId');
    await bad({ label: 'L', value: 'v' }, 'REQUIRED', 'key');
    expect(await owner.printValue.count({ where: { tenantId: A.h.tenant, key: k } })).toBe(0);
    // a formula-looking text is only text: it is stored as typed and never evaluated
    const formula = await add(A.admin, { key: key('frm'), label: 'Formula', value: '=1+1' }).expect(
      201,
    );
    expect(formula.body.value).toBe('=1+1');
    // the update has the same rules
    const id = formula.body.id as string;
    await http()
      .put(`/print-values/${id}`)
      .set(auth(A.admin))
      .send({ value: '<i>x</i>' })
      .expect(400);
    await http().put(`/print-values/${id}`).set(auth(A.admin)).send({}).expect(400);
    await http().put(`/print-values/${id}`).set(auth(A.admin)).send({ key: 'other' }).expect(400);
    await http().put(`/print-values/${id}`).set(auth(A.admin)).send({ active: 'yes' }).expect(400);
    expect(
      (await http().get('/print-values').set(auth(A.admin)).expect(200)).body.items.find(
        (i: { key: string }) => i.key === formula.body.key,
      ).text,
    ).toBe('=1+1');
  });

  it('a bad scope is a clean 400', async () => {
    const res = await add(A.admin, { key: key('sc'), label: 'L', value: 'v' }, 'everyone').expect(
      400,
    );
    expect(res.body.code).toBe('PRINT_SCOPE_INVALID');
  });

  // ------------------------------------------------------------------ who may change what

  it('a Branch Admin adds and changes values of their own branch only, never hospital-wide ones', async () => {
    const k = key('ba');
    await add(A.branchAdmin, { key: k, label: 'L', value: 'v' }).expect(403); // no scope = hospital
    await add(A.branchAdmin, { key: k, label: 'L', value: 'v' }, 'hospital').expect(403);
    const own = (
      await add(A.branchAdmin, { key: k, label: 'Mine', value: 'main branch' }, 'branch').expect(
        201,
      )
    ).body;
    expect(own.scope).toBe('BRANCH');
    expect((await owner.printValue.findUniqueOrThrow({ where: { id: own.id } })).branchId).toBe(
      A.h.main,
    );
    await http()
      .put(`/print-values/${own.id}`)
      .set(auth(A.branchAdmin))
      .send({ value: 'changed' })
      .expect(200);
    // a hospital-wide value is visible to them, but cannot be changed by them
    const wide = (await add(A.admin, { key: key('wide'), label: 'Wide', value: 'w' }).expect(201))
      .body;
    const manage = await http().get('/print-values/manage').set(auth(A.branchAdmin)).expect(200);
    expect(manage.body.items.some((i: { id: string }) => i.id === wide.id)).toBe(true);
    expect(manage.body.canChange).toEqual({ branch: true, hospital: false });
    await http()
      .put(`/print-values/${wide.id}`)
      .set(auth(A.branchAdmin))
      .send({ active: false })
      .expect(403);
    expect((await owner.printValue.findUniqueOrThrow({ where: { id: wide.id } })).active).toBe(
      true,
    );
    // SuperAdmin sees the same list with both rights
    const sa = await http().get('/print-values/manage').set(auth(A.admin)).expect(200);
    expect(sa.body.canChange).toEqual({ branch: true, hospital: true });
  });

  it("another branch's value looks like it does not exist, and so does another hospital's", async () => {
    const eastValue = (
      await add(A.adminEast, { key: key('eonly'), label: 'E', value: 'e' }, 'branch').expect(201)
    ).body;
    // the Branch Admin of MAIN cannot see or change the EAST value
    const manage = await http().get('/print-values/manage').set(auth(A.branchAdmin)).expect(200);
    expect(manage.body.items.some((i: { id: string }) => i.id === eastValue.id)).toBe(false);
    await http()
      .put(`/print-values/${eastValue.id}`)
      .set(auth(A.branchAdmin))
      .send({ active: false })
      .expect(404);
    // even the SuperAdmin signed in at MAIN cannot reach it (the branch comes from the token)
    await http()
      .put(`/print-values/${eastValue.id}`)
      .set(auth(A.admin))
      .send({ active: false })
      .expect(404);
    // hospital B cannot see or change anything of hospital A
    const aWide = (await add(A.admin, { key: key('awide'), label: 'A', value: 'a' }).expect(201))
      .body;
    await http()
      .put(`/print-values/${aWide.id}`)
      .set(auth(B.admin))
      .send({ active: false })
      .expect(404);
    const bItems = await effective(B.admin);
    expect(bItems.some((i) => i.key === aWide.key)).toBe(false);
    const bManage = await http().get('/print-values/manage').set(auth(B.admin)).expect(200);
    expect(bManage.body.items.some((i: { id: string }) => i.id === aWide.id)).toBe(false);
    expect((await owner.printValue.findUniqueOrThrow({ where: { id: aWide.id } })).active).toBe(
      true,
    );
    await http()
      .put('/print-values/not%20an%20id')
      .set(auth(A.admin))
      .send({ active: false })
      .expect(400);
  });

  // ------------------------------------------------------------------ templates may use them

  it('a template can hold a value.<key> field; an unknown or malformed one is refused', async () => {
    const k = key('tpl');
    await add(A.admin, { key: k, label: 'Tpl', value: 'shown on the slip' }).expect(201);
    const body = JSON.parse(JSON.stringify(presetInput('A4_FULL', 'REGISTRATION_SLIP')));
    const box = {
      id: 'extra1',
      type: 'RICH',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 10,
      content: { paragraphs: [{ runs: [{ t: 'field', field: `value.${k}` }] }] },
    };
    body.layout.elements = [...body.layout.elements, box];
    const saved = await http()
      .put('/print-templates/REGISTRATION_SLIP?scope=branch')
      .set(auth(A.owner))
      .send(body)
      .expect(200);
    expect(JSON.stringify(saved.body.layout)).toContain(`value.${k}`);
    // a malformed name is still refused
    for (const field of ['value.', 'value.UPPER', 'value.a b', 'valuex', 'value.1a', 'value..x']) {
      const broken = JSON.parse(JSON.stringify(body));
      broken.layout.elements[
        broken.layout.elements.length - 1
      ].content.paragraphs[0].runs[0].field = field;
      const res = await http()
        .put('/print-templates/REGISTRATION_SLIP?scope=branch')
        .set(auth(A.owner))
        .send(broken)
        .expect(400);
      expect(res.body.code).toBe('PRINT_TEMPLATE_INVALID');
    }
  });

  // ------------------------------------------------------------------ database guards

  it('the database never deletes a value, keeps its identity, and refuses markup and a wrong-hospital branch', async () => {
    const made = (await add(A.admin, { key: key('db'), label: 'DB', value: 'v' }).expect(201)).body;
    await expect(owner.printValue.delete({ where: { id: made.id } })).rejects.toThrow();
    await expect(owner.$executeRawUnsafe('TRUNCATE TABLE print_values')).rejects.toThrow();
    await expect(
      owner.printValue.update({ where: { id: made.id }, data: { key: 'renamed' } }),
    ).rejects.toThrow();
    await expect(
      owner.printValue.update({ where: { id: made.id }, data: { branchId: A.h.main } }),
    ).rejects.toThrow();
    await expect(
      owner.printValue.update({ where: { id: made.id }, data: { value: '<b>x</b>' } }),
    ).rejects.toThrow();
    await expect(
      owner.printValue.update({ where: { id: made.id }, data: { value: 'a\nb' } }),
    ).rejects.toThrow();
    await expect(
      owner.printValue.update({ where: { id: made.id }, data: { value: 'a\u202Eb' } }),
    ).rejects.toThrow();
    await expect(
      owner.printValue.create({
        data: {
          tenantId: A.h.tenant,
          branchId: B.h.main,
          key: key('cross'),
          label: 'x',
          value: 'y',
          createdBy: (await owner.user.findFirstOrThrow({ where: { tenantId: A.h.tenant } })).id,
          updatedBy: (await owner.user.findFirstOrThrow({ where: { tenantId: A.h.tenant } })).id,
        },
      }),
    ).rejects.toThrow();
    expect((await owner.printValue.findUniqueOrThrow({ where: { id: made.id } })).value).toBe('v');
  });
});
