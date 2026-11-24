import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';

prepareTestEnv();

type Cast = {
  h: KitHospital;
  admin: string;
  branchAdmin: string;
  nobody: string;
  recv: string;
  nurse: string;
};

describe('Masters screens: payment modes and vitals fields (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let A: Cast;
  let B: Cast;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function seed(label: string, kit: ReturnType<typeof createKit>): Promise<Cast> {
    const h = await kit.hospital(label);
    const cast = await kit.cast(h);
    const recv = await kit.person(h, 'recv', [h.main], {
      permissions: ['opd.visits.read', 'opd.billing.collect', 'opd.masters.read'],
      scope: 'BRANCH',
    });
    const nurse = await kit.person(h, 'nurse', [h.main], {
      permissions: ['opd.vitals.read', 'opd.vitals.write'],
      scope: 'BRANCH',
    });
    for (const [code, name, requiresReference] of [
      ['CASH', 'Cash', false],
      ['UPI', 'UPI', true],
    ] as const) {
      await owner.paymentMode.create({
        data: { tenantId: h.tenant, code, name, requiresReference },
      });
    }
    for (const [i, [code, name, unit, min, max]] of (
      [
        ['pulse', 'Pulse', 'bpm', 50, 120],
        ['spo2', 'SpO2', '%', 90, 100],
        ['notes', 'Remarks', '', null, null],
      ] as const
    ).entries()) {
      await owner.vitalsField.create({
        data: {
          tenantId: h.tenant,
          code,
          name,
          unit: unit || '-',
          valueKind: code === 'notes' ? 'TEXT' : 'NUMBER',
          displayOrder: i + 1,
          warnMin: min,
          warnMax: max,
        },
      });
    }
    return {
      h,
      admin: cast.admin,
      branchAdmin: cast.branchAdmin,
      nobody: cast.nobody,
      recv: recv.token(h.main),
      nurse: nurse.token(h.main),
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

  const modes = async (c: Cast) =>
    (await http().get('/settings/payment-modes').set(auth(c.admin)).expect(200)).body
      .items as Array<{
      id: string;
      code: string;
      name: string;
      requiresReference: boolean;
      active: boolean;
      isDefault: boolean;
    }>;
  const modeId = async (c: Cast, code: string) => (await modes(c)).find((m) => m.code === code)!.id;
  const fields = async (c: Cast) =>
    (await http().get('/settings/vitals-fields').set(auth(c.admin)).expect(200)).body
      .items as Array<{
      id: string;
      code: string;
      name: string;
      unit: string;
      valueKind: string;
      displayOrder: number;
      warnMin: number | null;
      warnMax: number | null;
      active: boolean;
      readingsCount: number;
    }>;
  const fieldId = async (c: Cast, code: string) =>
    (await fields(c)).find((f) => f.code === code)!.id;

  // ------------------------------------------------------------------ who may use it

  it('needs a token (401) and the masters permission (403): reception, a nurse and nobody are refused', async () => {
    const id = await modeId(A, 'CASH');
    const calls: Array<(t?: string) => request.Test> = [
      (t) => withAuth(http().get('/settings/payment-modes'), t),
      (t) => withAuth(http().post('/settings/payment-modes').send({}), t),
      (t) => withAuth(http().put(`/settings/payment-modes/${id}`).send({ name: 'X' }), t),
      (t) => withAuth(http().get('/settings/vitals-fields'), t),
      (t) => withAuth(http().post('/settings/vitals-fields').send({}), t),
      (t) =>
        withAuth(
          http()
            .post('/settings/vitals-fields/reorder')
            .send({ ids: ['x'] }),
          t,
        ),
      (t) => withAuth(http().put(`/settings/vitals-fields/${id}`).send({ name: 'X' }), t),
    ];
    function withAuth(r: request.Test, token?: string): request.Test {
      return token ? r.set(auth(token)) : r;
    }
    for (const call of calls) {
      expect((await call()).status).toBe(401);
      for (const who of [A.recv, A.nurse, A.nobody]) {
        expect((await call(who)).status).toBe(403);
      }
    }
    // an Admin of one branch may change the masters (decided like the prices): they are allowed
    expect((await withAuth(http().get('/settings/payment-modes'), A.branchAdmin)).status).toBe(200);
  });

  it('ids that are not ids are refused with 400', async () => {
    await http()
      .put('/settings/payment-modes/a%2Fb')
      .set(auth(A.admin))
      .send({ name: 'X' })
      .expect(400);
    await http()
      .put('/settings/vitals-fields/bad%20id')
      .set(auth(A.admin))
      .send({ name: 'X' })
      .expect(400);
  });

  // ------------------------------------------------------------------ payment modes

  describe('payment modes', () => {
    it('adds a mode: the code is made upper case, the mode shows on the billing list with its flag', async () => {
      const res = await http()
        .post('/settings/payment-modes')
        .set(auth(A.admin))
        .send({ code: ' neft ', name: '  Bank   transfer ', requiresReference: true })
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'NEFT',
        name: 'Bank transfer',
        requiresReference: true,
        active: true,
        isDefault: false,
        paymentsCount: 0,
      });
      const billing = await http().get('/opd/payment-modes').set(auth(A.recv)).expect(200);
      expect(billing.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'NEFT', name: 'Bank transfer', requiresReference: true }),
        ]),
      );
    });

    it('refuses bad codes and names, duplicates and anything extra', async () => {
      const add = (body: unknown) =>
        http()
          .post('/settings/payment-modes')
          .set(auth(A.admin))
          .send(body as object);
      const reason = async (body: unknown, status = 400) => {
        const res = await add(body).expect(status);
        return res.body.reason as string;
      };
      expect(await reason({ code: 'x', name: 'X', requiresReference: false })).toBe('CODE_INVALID');
      expect(await reason({ code: 'HAS SPACE', name: 'X', requiresReference: false })).toBe(
        'CODE_INVALID',
      );
      expect(await reason({ code: 'GOOD1', name: '', requiresReference: false })).toBe('REQUIRED');
      expect(await reason({ code: 'GOOD1', name: 'a'.repeat(41), requiresReference: false })).toBe(
        'TOO_LONG',
      );
      expect(await reason({ code: 'GOOD1', name: '<b>x</b>', requiresReference: false })).toBe(
        'NOT_PLAIN_TEXT',
      );
      expect(await reason({ code: 'GOOD1', name: 'Fine', requiresReference: 'yes' })).toBe(
        'NOT_A_BOOLEAN',
      );
      expect(
        await reason({ code: 'GOOD1', name: 'Fine', requiresReference: false, active: false }),
      ).toBe('UNKNOWN_FIELD');
      expect(await reason({ code: 'CASH', name: 'Again', requiresReference: false }, 409)).toBe(
        'CODE_USED',
      );
      // a code of another hospital does not matter
      await http()
        .post('/settings/payment-modes')
        .set(auth(B.admin))
        .send({ code: 'NEFT', name: 'Bank transfer', requiresReference: false })
        .expect(201);
    });

    it('two requests for the same new code at the same moment make one mode', async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          http()
            .post('/settings/payment-modes')
            .set(auth(A.admin))
            .send({ code: 'RACE', name: 'Race', requiresReference: false }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect((await modes(A)).filter((m) => m.code === 'RACE')).toHaveLength(1);
    });

    it('renames, changes the flag, switches off and on; the code never changes; nothing is deleted', async () => {
      const id = (
        await http()
          .post('/settings/payment-modes')
          .set(auth(A.admin))
          .send({ code: 'WALLET', name: 'Wallet', requiresReference: false })
          .expect(201)
      ).body.id as string;
      const put = (body: unknown) =>
        http()
          .put(`/settings/payment-modes/${id}`)
          .set(auth(A.admin))
          .send(body as object);
      expect((await put({ name: 'Digital wallet' }).expect(200)).body.name).toBe('Digital wallet');
      expect((await put({ requiresReference: true }).expect(200)).body.requiresReference).toBe(
        true,
      );
      expect((await put({ active: false }).expect(200)).body.active).toBe(false);
      // a switched-off mode is not offered when taking payment, and is back when switched on
      let billing = await http().get('/opd/payment-modes').set(auth(A.recv)).expect(200);
      expect(billing.body.items.map((m: { code: string }) => m.code)).not.toContain('WALLET');
      expect((await put({ active: true }).expect(200)).body.active).toBe(true);
      billing = await http().get('/opd/payment-modes').set(auth(A.recv)).expect(200);
      expect(billing.body.items.map((m: { code: string }) => m.code)).toContain('WALLET');
      // the code cannot be changed, nothing else is accepted, an empty change is refused
      expect((await put({ code: 'OTHER' }).expect(400)).body.reason).toBe('UNKNOWN_FIELD');
      expect((await put({}).expect(400)).body.reason).toBe('NOTHING_TO_CHANGE');
      expect((await put({ active: 'no' }).expect(400)).body.reason).toBe('NOT_A_BOOLEAN');
      // never deleted: there is no such route, and the row is still there
      expect((await http().delete(`/settings/payment-modes/${id}`).set(auth(A.admin))).status).toBe(
        404,
      );
      expect(await owner.paymentMode.count({ where: { id } })).toBe(1);
    });

    it('the default mode (CASH) and the last active mode cannot be switched off', async () => {
      const cash = await modeId(A, 'CASH');
      const res = await http()
        .put(`/settings/payment-modes/${cash}`)
        .set(auth(A.admin))
        .send({ active: false })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'MASTER_CONFLICT', reason: 'DEFAULT_MODE' });
      // a hospital whose only active mode is not CASH
      await http()
        .post('/settings/payment-modes')
        .set(auth(B.admin))
        .send({ code: 'ONLY', name: 'Only', requiresReference: false })
        .expect(201);
      // every other mode of that hospital is off (the owner login sets the scene)
      const others = await owner.paymentMode.findMany({
        where: { tenantId: B.h.tenant, code: { not: 'ONLY' }, active: true },
        select: { id: true },
      });
      await owner.paymentMode.updateMany({
        where: { id: { in: others.map((m) => m.id) } },
        data: { active: false },
      });
      const only = await modeId(B, 'ONLY');
      const last = await http()
        .put(`/settings/payment-modes/${only}`)
        .set(auth(B.admin))
        .send({ active: false })
        .expect(409);
      expect(last.body.reason).toBe('LAST_ACTIVE');
      await owner.paymentMode.updateMany({
        where: { id: { in: others.map((m) => m.id) } },
        data: { active: true },
      });
    });

    it('another hospital cannot see or change a mode of this one', async () => {
      const id = await modeId(A, 'UPI');
      await http()
        .put(`/settings/payment-modes/${id}`)
        .set(auth(B.admin))
        .send({ name: 'Hacked' })
        .expect(404);
      expect((await owner.paymentMode.findUniqueOrThrow({ where: { id } })).name).toBe('UPI');
      expect((await modes(B)).map((m) => m.id)).not.toContain(id);
    });

    it('the audit trail keeps ids and field names only, and a change that changes nothing writes nothing', async () => {
      const id = await modeId(A, 'UPI');
      const count = () =>
        owner.auditLog.count({
          where: { tenantId: A.h.tenant, action: 'PAYMENT_MODE_CHANGE', entityId: id },
        });
      const before = await count();
      await http()
        .put(`/settings/payment-modes/${id}`)
        .set(auth(A.admin))
        .send({ name: 'UPI' })
        .expect(200);
      expect(await count()).toBe(before);
      await http()
        .put(`/settings/payment-modes/${id}`)
        .set(auth(A.admin))
        .send({ name: 'UPI payment' })
        .expect(200);
      const rows = await owner.auditLog.findMany({
        where: { tenantId: A.h.tenant, action: 'PAYMENT_MODE_CHANGE', entityId: id },
        orderBy: { createdAt: 'desc' },
      });
      expect(rows).toHaveLength(before + 1);
      expect(rows[0]!.metadata).toEqual({ kind: 'UPDATE', changed: ['name'] });
      expect(JSON.stringify(rows[0]!.metadata)).not.toContain('UPI payment');
      await http()
        .put(`/settings/payment-modes/${id}`)
        .set(auth(A.admin))
        .send({ name: 'UPI' })
        .expect(200);
    });
  });

  // ------------------------------------------------------------------ vitals fields

  describe('vitals fields', () => {
    it('adds a number field with a usual range at the end; the nurse list shows it with the range', async () => {
      const res = await http()
        .post('/settings/vitals-fields')
        .set(auth(A.admin))
        .send({
          code: 'Glucose',
          name: 'Blood sugar',
          unit: 'mg/dL',
          valueKind: 'NUMBER',
          warnMin: 70,
          warnMax: 180,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'glucose',
        name: 'Blood sugar',
        unit: 'mg/dL',
        valueKind: 'NUMBER',
        warnMin: 70,
        warnMax: 180,
        active: true,
        readingsCount: 0,
      });
      const all = await fields(A);
      expect(res.body.displayOrder).toBe(Math.max(...all.map((f) => f.displayOrder)));
      const nurse = await http().get('/opd/vitals-fields').set(auth(A.nurse)).expect(200);
      expect(nurse.body.items.find((f: { code: string }) => f.code === 'glucose')).toMatchObject({
        warnMin: 70,
        warnMax: 180,
      });
    });

    it('refuses bad codes, kinds, ranges, duplicates and anything extra', async () => {
      const add = (body: unknown) =>
        http()
          .post('/settings/vitals-fields')
          .set(auth(A.admin))
          .send(body as object);
      const good = { code: 'height', name: 'Height', unit: 'cm', valueKind: 'NUMBER' };
      const reason = async (body: unknown, status = 400) =>
        (await add(body).expect(status)).body.reason as string;
      expect(await reason({ ...good, code: '1bad' })).toBe('CODE_INVALID');
      expect(await reason({ ...good, valueKind: 'DATE' })).toBe('KIND_INVALID');
      expect(await reason({ ...good, unit: '' })).toBe('REQUIRED');
      expect(await reason({ ...good, unit: 'x'.repeat(13) })).toBe('TOO_LONG');
      expect(await reason({ ...good, warnMin: 100, warnMax: 100 })).toBe('MAX_NOT_ABOVE_MIN');
      expect(await reason({ ...good, warnMin: 100, warnMax: 50 })).toBe('MAX_NOT_ABOVE_MIN');
      expect(await reason({ ...good, warnMin: '10' })).toBe('NOT_A_NUMBER');
      expect(await reason({ ...good, warnMin: 1.234 })).toBe('TOO_MANY_DECIMALS');
      expect(await reason({ ...good, warnMax: 1e9 })).toBe('OUT_OF_RANGE');
      expect(await reason({ ...good, valueKind: 'TEXT', warnMin: 1 })).toBe('WARN_NEEDS_NUMBER');
      expect(await reason({ ...good, extra: 1 })).toBe('UNKNOWN_FIELD');
      expect(await reason({ ...good, code: 'pulse' }, 409)).toBe('CODE_USED');
      expect((await add({ ...good, name: '<script>' }).expect(400)).body.reason).toBe(
        'NOT_PLAIN_TEXT',
      );
    });

    it('changes name, unit and range, clears a range with null; the code and the kind never change', async () => {
      const id = await fieldId(A, 'pulse');
      const put = (body: unknown) =>
        http()
          .put(`/settings/vitals-fields/${id}`)
          .set(auth(A.admin))
          .send(body as object);
      const changed = await put({
        name: 'Heart rate',
        unit: 'beats/min',
        warnMin: 55,
        warnMax: 110,
      }).expect(200);
      expect(changed.body).toMatchObject({
        name: 'Heart rate',
        unit: 'beats/min',
        warnMin: 55,
        warnMax: 110,
      });
      // the new maximum must stay above the existing minimum
      expect((await put({ warnMax: 40 }).expect(400)).body.reason).toBe('MAX_NOT_ABOVE_MIN');
      expect((await put({ warnMin: 200 }).expect(400)).body.reason).toBe('MAX_NOT_ABOVE_MIN');
      const cleared = await put({ warnMin: null, warnMax: null }).expect(200);
      expect(cleared.body).toMatchObject({ warnMin: null, warnMax: null });
      expect((await put({ code: 'x' }).expect(400)).body.reason).toBe('UNKNOWN_FIELD');
      expect((await put({ valueKind: 'TEXT' }).expect(400)).body.reason).toBe('UNKNOWN_FIELD');
      expect((await put({}).expect(400)).body.reason).toBe('NOTHING_TO_CHANGE');
      // a text field takes no range
      const notes = await fieldId(A, 'notes');
      expect(
        (
          await http()
            .put(`/settings/vitals-fields/${notes}`)
            .set(auth(A.admin))
            .send({ warnMin: 1 })
            .expect(400)
        ).body.reason,
      ).toBe('WARN_NEEDS_NUMBER');
      await put({ name: 'Pulse', unit: 'bpm', warnMin: 50, warnMax: 120 }).expect(200);
    });

    it('switches a field off (the nurse list drops it) and on again; nothing is deleted', async () => {
      const id = await fieldId(A, 'spo2');
      await http()
        .put(`/settings/vitals-fields/${id}`)
        .set(auth(A.admin))
        .send({ active: false })
        .expect(200);
      let nurse = await http().get('/opd/vitals-fields').set(auth(A.nurse)).expect(200);
      expect(nurse.body.items.map((f: { code: string }) => f.code)).not.toContain('spo2');
      expect((await fields(A)).find((f) => f.code === 'spo2')?.active).toBe(false);
      await http()
        .put(`/settings/vitals-fields/${id}`)
        .set(auth(A.admin))
        .send({ active: true })
        .expect(200);
      nurse = await http().get('/opd/vitals-fields').set(auth(A.nurse)).expect(200);
      expect(nurse.body.items.map((f: { code: string }) => f.code)).toContain('spo2');
      expect((await http().delete(`/settings/vitals-fields/${id}`).set(auth(A.admin))).status).toBe(
        404,
      );
    });

    it("reorders: the list must be complete; another hospital's id, a missing id or a repeat is refused", async () => {
      const all = await fields(A);
      const ids = all.map((f) => f.id);
      const reversed = [...ids].reverse();
      const res = await http()
        .post('/settings/vitals-fields/reorder')
        .set(auth(A.admin))
        .send({ ids: reversed })
        .expect(200);
      expect(res.body.items.map((f: { id: string }) => f.id)).toEqual(reversed);
      expect(res.body.items.map((f: { displayOrder: number }) => f.displayOrder)).toEqual(
        reversed.map((_, i) => i + 1),
      );
      const nurse = await http().get('/opd/vitals-fields').set(auth(A.nurse)).expect(200);
      expect(nurse.body.items.map((f: { code: string }) => f.code)).toEqual(
        reversed
          .map((id) => all.find((f) => f.id === id)!.code)
          .filter((c) => nurse.body.items.some((f: { code: string }) => f.code === c)),
      );
      const post = (body: unknown) =>
        http()
          .post('/settings/vitals-fields/reorder')
          .set(auth(A.admin))
          .send(body as object);
      expect((await post({ ids: ids.slice(1) }).expect(409)).body.reason).toBe('IDS_MISMATCH');
      expect(
        (await post({ ids: [...ids.slice(1), await fieldId(B, 'pulse')] }).expect(409)).body.reason,
      ).toBe('IDS_MISMATCH');
      expect((await post({ ids: [ids[0], ids[0]] }).expect(400)).body.reason).toBe('IDS_DUPLICATE');
      expect((await post({ ids: [] }).expect(400)).body.reason).toBe('IDS_INVALID');
      expect((await post({ ids: ['a/b'] }).expect(400)).body.reason).toBe('IDS_INVALID');
    });

    it('another hospital cannot see or change a field of this one', async () => {
      const id = await fieldId(A, 'pulse');
      await http()
        .put(`/settings/vitals-fields/${id}`)
        .set(auth(B.admin))
        .send({ name: 'Hacked' })
        .expect(404);
      expect((await owner.vitalsField.findUniqueOrThrow({ where: { id } })).name).toBe('Pulse');
      expect((await fields(B)).map((f) => f.id)).not.toContain(id);
    });

    it('the audit trail keeps ids and field names only', async () => {
      const id = await fieldId(A, 'notes');
      await http()
        .put(`/settings/vitals-fields/${id}`)
        .set(auth(A.admin))
        .send({ name: 'Remarks (nurse)' })
        .expect(200);
      const row = await owner.auditLog.findFirstOrThrow({
        where: { tenantId: A.h.tenant, action: 'VITALS_FIELD_CHANGE', entityId: id },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.metadata).toEqual({ kind: 'UPDATE', changed: ['name'] });
      await http()
        .put(`/settings/vitals-fields/${id}`)
        .set(auth(A.admin))
        .send({ name: 'Remarks' })
        .expect(200);
    });
  });
});
