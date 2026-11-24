import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';

prepareTestEnv();

const NEW_FEE = 50_000;
const FOLLOW_UP_FEE = 30_000;
const REG_FEE = 10_000;
const OPD_PERMS = [
  'opd.visits.create',
  'opd.visits.read',
  'opd.billing.collect',
  'opd.billing.read',
  'patients.registry.read',
] as const;

type Cast = {
  h: KitHospital;
  staffId: string;
  sa: string; // SuperAdmin (hospital-wide), active in Main
  saEast: string; // the same SuperAdmin, active in East
  baMain: string; // Branch Admin of Main only
  baEast: string; // Branch Admin of East only
  recvMain: string;
  recvEast: string;
  docBoth: string; // works in Main and East; hospital-wide NEW and FOLLOW_UP fees
  docMainOnly: string;
  docOnlyNew: string; // works in both; hospital-wide NEW fee only (no follow-up fee at all)
};

/** Step 9: per-branch doctor fees (money path). */
describe('Per-branch doctor fees (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let A: Cast;
  let B: Cast;
  const stamp = Date.now();
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function seed(
    label: string,
    kit: ReturnType<typeof createKit>,
    tokens: never,
  ): Promise<Cast> {
    void tokens;
    const h = await kit.hospital(label);
    for (const series of ['BILL', 'RECEIPT'] as const) {
      await owner.numberSeriesSettings.create({
        data: {
          tenantId: h.tenant,
          series,
          format: [
            { type: 'FINANCIAL_YEAR', style: 'SHORT' },
            { type: 'SEPARATOR', text: '/' },
            { type: 'RUNNING', width: 5 },
          ],
          resetRule: 'FINANCIAL_YEAR',
          fyStartMonth: 4,
        },
      });
    }
    await owner.paymentMode.create({
      data: { tenantId: h.tenant, code: 'CASH', name: 'CASH', requiresReference: false },
    });
    const sa = await kit.person(h, 'sa', [h.main, h.east], {
      roleId: h.superAdminRoleId,
      scope: 'HOSPITAL',
    });
    const baMain = await kit.person(h, 'bam', [h.main], {
      roleId: h.branchAdminRoleId,
      scope: 'BRANCH',
    });
    const baEast = await kit.person(h, 'bae', [h.east], {
      roleId: h.branchAdminRoleId,
      scope: 'BRANCH',
    });
    const recvMain = await kit.person(h, 'rm', [h.main], {
      permissions: OPD_PERMS,
      scope: 'BRANCH',
    });
    const recvEast = await kit.person(h, 're', [h.east], {
      permissions: OPD_PERMS,
      scope: 'BRANCH',
    });
    const regItem = await owner.chargeItem.create({
      data: { tenantId: h.tenant, code: 'REG', name: 'Registration', kind: 'REGISTRATION' },
    });
    await owner.chargeItemPrice.create({
      data: {
        tenantId: h.tenant,
        chargeItemId: regItem.id,
        amountPaise: REG_FEE,
        effectiveFrom: new Date('2020-01-01'),
        createdBy: sa.id,
      },
    });
    const doctor = async (
      key: string,
      branches: string[],
      fees: Array<['NEW' | 'FOLLOW_UP', number]>,
    ) => {
      const p = await kit.person(h, key, branches, {
        permissions: ['opd.visits.read'],
        scope: 'BRANCH',
      });
      const profile = await owner.doctorProfile.create({
        data: {
          tenantId: h.tenant,
          userId: p.id,
          code: `DOC_${key}_${label}_${stamp}`,
          availabilityOn: true,
        },
      });
      for (const [type, amount] of fees) {
        await owner.doctorFee.create({
          data: {
            tenantId: h.tenant,
            doctorProfileId: profile.id,
            visitType: type,
            amountPaise: amount,
            effectiveFrom: new Date('2020-01-01'),
            createdBy: sa.id,
          },
        });
      }
      return profile.id;
    };
    const docBoth = await doctor(
      'dboth',
      [h.main, h.east],
      [
        ['NEW', NEW_FEE],
        ['FOLLOW_UP', FOLLOW_UP_FEE],
      ],
    );
    const docMainOnly = await doctor('dmain', [h.main], [['NEW', NEW_FEE]]);
    const docOnlyNew = await doctor('donly', [h.main, h.east], [['NEW', 40_000]]);
    return {
      h,
      staffId: sa.id,
      sa: sa.token(h.main),
      saEast: sa.token(h.east),
      baMain: baMain.token(h.main),
      baEast: baEast.token(h.east),
      recvMain: recvMain.token(h.main),
      recvEast: recvEast.token(h.east),
      docBoth,
      docMainOnly,
      docOnlyNew,
    };
  }

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    const kit = createKit(owner, booted.tokens);
    A = await seed('A', kit, undefined as never);
    B = await seed('B', kit, undefined as never);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });
  beforeEach(() => {
    clock.set(new Date());
  });

  async function newPatient(c: Cast): Promise<string> {
    seq += 1;
    return (
      await owner.patient.create({
        data: {
          tenantId: c.h.tenant,
          uhid: `DFB${stamp}${seq}`,
          registeredBranchId: c.h.main,
          name: `Fee Patient ${seq}`,
          phone: `+91979${String(seq).padStart(7, '0')}`,
          createdBy: c.staffId,
        },
      })
    ).id;
  }

  const setFee = (token: string, body: Record<string, unknown>) =>
    http().post('/opd/prices/doctor-fees').set(auth(token)).send(body);

  /** Take a NEW visit with the doctor as the given receptionist; returns the bill total. */
  async function visitTotal(c: Cast, who: string, doctor: string): Promise<number> {
    const res = await http()
      .post('/opd/visits')
      .set(auth(who))
      .send({
        patientId: await newPatient(c),
        doctorProfileId: doctor,
        visitType: 'NEW',
        idempotencyKey: `DFB-KEY-${stamp}-${(seq += 1)}`,
      })
      .expect(201);
    return res.body.bill.totalPaise as number;
  }

  const doctorsOf = async (who: string, doctor: string) => {
    const res = await http().get('/opd/doctors').set(auth(who)).expect(200);
    const row = (
      res.body.items as Array<{
        id: string;
        feeNewPaise: number | null;
        feeFollowUpPaise: number | null;
      }>
    ).find((d) => d.id === doctor);
    return { newFee: row?.feeNewPaise, followUpFee: row?.feeFollowUpPaise };
  };

  // ---------------------------------------------------------------- lookup order (billing)

  it('a branch fee beats the hospital-wide fee in its branch only; the other branch and the hospital-wide row are untouched', async () => {
    // before: hospital-wide fee everywhere
    expect(await visitTotal(A, A.recvEast, A.docBoth)).toBe(NEW_FEE + REG_FEE);
    const res = await setFee(A.sa, {
      doctorProfileId: A.docBoth,
      visitType: 'NEW',
      amountPaise: 70_000,
      branchId: A.h.east,
    }).expect(200);
    expect(res.body).toMatchObject({ changed: true, previousAmountPaise: null });
    // East bills the branch fee, Main still the hospital-wide fee
    expect(await visitTotal(A, A.recvEast, A.docBoth)).toBe(70_000 + REG_FEE);
    expect(await visitTotal(A, A.recvMain, A.docBoth)).toBe(NEW_FEE + REG_FEE);
    // the follow-up has no branch row: the hospital-wide follow-up fee, not the East new-visit fee
    expect(await doctorsOf(A.recvEast, A.docBoth)).toEqual({
      newFee: 70_000,
      followUpFee: FOLLOW_UP_FEE,
    });
    expect(await doctorsOf(A.recvMain, A.docBoth)).toEqual({
      newFee: NEW_FEE,
      followUpFee: FOLLOW_UP_FEE,
    });
    // the hospital-wide rows were not changed or added
    expect(
      await owner.doctorFee.count({ where: { doctorProfileId: A.docBoth, branchId: null } }),
    ).toBe(2);
  });

  it('a follow-up with no follow-up fee at all costs the new-visit fee found branch first, then hospital-wide', async () => {
    await setFee(A.sa, {
      doctorProfileId: A.docOnlyNew,
      visitType: 'NEW',
      amountPaise: 60_000,
      branchId: A.h.east,
    }).expect(200);
    expect(await doctorsOf(A.recvEast, A.docOnlyNew)).toEqual({
      newFee: 60_000,
      followUpFee: 60_000,
    });
    expect(await doctorsOf(A.recvMain, A.docOnlyNew)).toEqual({
      newFee: 40_000,
      followUpFee: 40_000,
    });
  });

  it('effective dates: a branch fee that starts later is ignored until its day; bills already made never change', async () => {
    const first = await visitTotal(A, A.recvEast, A.docBoth); // East fee in effect now
    const billsBefore = await owner.bill.findMany({
      where: { tenantId: A.h.tenant, branchId: A.h.east },
      select: { id: true, totalPaise: true },
    });
    const day = (n: number) =>
      new Date(clock.now().getTime() + n * 86_400_000).toISOString().slice(0, 10);
    await setFee(A.sa, {
      doctorProfileId: A.docBoth,
      visitType: 'NEW',
      amountPaise: 90_000,
      branchId: A.h.east,
      effectiveFrom: day(2),
    }).expect(200);
    expect((await doctorsOf(A.recvEast, A.docBoth)).newFee).toBe(70_000);
    clock.set(new Date(clock.now().getTime() + 3 * 86_400_000));
    expect((await doctorsOf(A.recvEast, A.docBoth)).newFee).toBe(90_000);
    expect(await visitTotal(A, A.recvEast, A.docBoth)).toBe(90_000 + REG_FEE);
    // the bills made before are exactly as they were
    for (const b of billsBefore) {
      expect((await owner.bill.findUniqueOrThrow({ where: { id: b.id } })).totalPaise).toBe(
        b.totalPaise,
      );
    }
    expect(first).toBe(70_000 + REG_FEE);
  });

  // ---------------------------------------------------------------- who may set which fee

  it('a Branch Admin sets fees of their own branch only: never another branch, never the hospital-wide fee', async () => {
    const before = await owner.doctorFee.count({ where: { tenantId: A.h.tenant } });
    const body = (branchId?: string) => ({
      doctorProfileId: A.docBoth,
      visitType: 'FOLLOW_UP',
      amountPaise: 20_000,
      ...(branchId ? { branchId } : {}),
    });
    // own branch: allowed
    await setFee(A.baMain, body(A.h.main)).expect(200);
    // another branch: refused, so is the hospital-wide fee (no branch)
    for (const refused of [body(A.h.east), body()]) {
      const res = await setFee(A.baMain, refused).expect(403);
      expect(res.body.code).toBe('PRICE_SCOPE_FORBIDDEN');
    }
    // the East Branch Admin has no power over Main either
    await setFee(A.baEast, body(A.h.main)).expect(403);
    await setFee(A.baEast, body(A.h.east)).expect(200);
    expect(await owner.doctorFee.count({ where: { tenantId: A.h.tenant } })).toBe(before + 2);
    // a hospital-wide Admin may set the hospital-wide fee and any branch
    await setFee(A.sa, body()).expect(200);
    await setFee(A.sa, {
      doctorProfileId: A.docBoth,
      visitType: 'NEW',
      amountPaise: 21_000,
      branchId: A.h.main,
    }).expect(200);
    // nobody and a receptionist are refused whatever they ask
    await setFee(A.recvMain, body(A.h.main)).expect(403);
  });

  it('a Branch Admin reads the fees of their own branch only; the list says who may set the hospital-wide fee', async () => {
    const mine = await http()
      .get(`/opd/prices?kind=DOCTOR_FEE&branchId=${A.h.main}&pageSize=100`)
      .set(auth(A.baMain))
      .expect(200);
    expect(mine.body.canSetHospitalWide).toBe(false);
    await http()
      .get(`/opd/prices?kind=DOCTOR_FEE&branchId=${A.h.east}`)
      .set(auth(A.baMain))
      .expect(403);
    await http()
      .get(`/opd/prices/history?doctorProfileId=${A.docBoth}&visitType=NEW&branchId=${A.h.east}`)
      .set(auth(A.baMain))
      .expect(403);
    const wide = await http()
      .get(`/opd/prices?kind=DOCTOR_FEE&branchId=${A.h.east}&pageSize=100`)
      .set(auth(A.sa))
      .expect(200);
    expect(wide.body.canSetHospitalWide).toBe(true);
  });

  // ---------------------------------------------------------------- list and history

  it('the list shows the fee of the chosen branch with its scope; without a branch it shows the hospital-wide fee', async () => {
    type Row = {
      doctorProfileId: string;
      visitType: string;
      currentAmountPaise: number | null;
      feeScope: string | null;
    };
    const rows = async (query: string) =>
      (
        await http()
          .get(`/opd/prices?kind=DOCTOR_FEE&pageSize=100${query}`)
          .set(auth(A.sa))
          .expect(200)
      ).body.items as Row[];
    const find = (list: Row[], doctor: string, type: string) =>
      list.find((r) => r.doctorProfileId === doctor && r.visitType === type)!;
    const east = await rows(`&branchId=${A.h.east}`);
    // docBoth has East fees now (set above): the scope says BRANCH
    expect(find(east, A.docBoth, 'NEW').feeScope).toBe('BRANCH');
    // docOnlyNew has a branch NEW fee in East, so its follow-up row follows the East new-visit fee
    expect(find(east, A.docOnlyNew, 'FOLLOW_UP').currentAmountPaise).toBe(60_000);
    // the doctor who works in Main only is not in the East list at all
    expect(east.some((r) => r.doctorProfileId === A.docMainOnly)).toBe(false);
    const main = await rows(`&branchId=${A.h.main}`);
    expect(find(main, A.docMainOnly, 'NEW')).toMatchObject({
      currentAmountPaise: NEW_FEE,
      feeScope: 'HOSPITAL',
    });
    // no branch: the hospital-wide fees only
    const wide = await rows('');
    expect(find(wide, A.docOnlyNew, 'NEW')).toMatchObject({
      currentAmountPaise: 40_000,
      feeScope: 'HOSPITAL',
    });
  });

  it('history of a branch fee shows only that branch versions; the default shows the hospital-wide ones', async () => {
    const hist = async (query: string) =>
      (
        await http()
          .get(`/opd/prices/history?doctorProfileId=${A.docBoth}&visitType=NEW${query}`)
          .set(auth(A.sa))
          .expect(200)
      ).body.items as Array<{ amountPaise: number }>;
    const eastVersions = (await hist(`&branchId=${A.h.east}`)).map((v) => v.amountPaise);
    expect(eastVersions).toEqual(expect.arrayContaining([70_000, 90_000]));
    expect(eastVersions).not.toContain(NEW_FEE);
    expect((await hist('')).map((v) => v.amountPaise)).toEqual([NEW_FEE]);
  });

  // ---------------------------------------------------------------- isolation and bad input

  it('refuses a branch of another hospital, an unknown branch and a doctor who does not work there', async () => {
    const before = await owner.doctorFee.count({ where: { tenantId: A.h.tenant } });
    for (const branchId of [B.h.main, 'no-such-branch']) {
      const res = await setFee(A.sa, {
        doctorProfileId: A.docBoth,
        visitType: 'NEW',
        amountPaise: 1,
        branchId,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'PRICE_INVALID',
        field: 'branchId',
        reason: 'BRANCH_NOT_FOUND',
      });
    }
    // docMainOnly does not work in East
    const res = await setFee(A.sa, {
      doctorProfileId: A.docMainOnly,
      visitType: 'NEW',
      amountPaise: 1,
      branchId: A.h.east,
    }).expect(400);
    expect(res.body).toMatchObject({ reason: 'DOCTOR_NOT_IN_BRANCH' });
    // another hospital's doctor is simply not found
    await setFee(A.sa, { doctorProfileId: B.docBoth, visitType: 'NEW', amountPaise: 1 }).expect(
      404,
    );
    expect(await owner.doctorFee.count({ where: { tenantId: A.h.tenant } })).toBe(before);
  });

  it('the same amount again changes nothing; two different changes at the same moment: one wins', async () => {
    const body = {
      doctorProfileId: A.docMainOnly,
      visitType: 'NEW',
      amountPaise: 55_000,
      branchId: A.h.main,
    };
    expect((await setFee(A.sa, body).expect(200)).body.changed).toBe(true);
    expect((await setFee(A.sa, body).expect(200)).body.changed).toBe(false);
    const rows = await owner.doctorFee.count({
      where: { doctorProfileId: A.docMainOnly, branchId: A.h.main },
    });
    expect(rows).toBe(1);
    // a scope with no version yet: two different amounts at the same moment, one wins
    const race = { ...body, doctorProfileId: A.docOnlyNew };
    const [x, y] = await Promise.all([
      setFee(A.sa, { ...race, amountPaise: 56_000 }),
      setFee(A.sa, { ...race, amountPaise: 57_000 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 400]);
  });

  // ---------------------------------------------------------------- the database

  it('the database keeps fee rows append-only and inside the hospital, one version per scope and moment', async () => {
    const row = await owner.doctorFee.findFirstOrThrow({
      where: { doctorProfileId: A.docBoth, branchId: A.h.east },
    });
    await expect(
      owner.doctorFee.update({ where: { id: row.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow();
    await expect(
      owner.doctorFee.update({ where: { id: row.id }, data: { branchId: null } }),
    ).rejects.toThrow();
    await expect(owner.doctorFee.delete({ where: { id: row.id } })).rejects.toThrow();
    // a branch of another hospital cannot be attached
    await expect(
      owner.doctorFee.create({
        data: {
          tenantId: A.h.tenant,
          doctorProfileId: A.docBoth,
          branchId: B.h.main,
          visitType: 'NEW',
          amountPaise: 1,
          effectiveFrom: new Date('2031-01-01'),
          createdBy: A.staffId,
        },
      }),
    ).rejects.toThrow();
    // the same doctor, type, branch and moment twice is refused; a hospital-wide row at that moment is not
    const at = new Date('2032-01-01T00:00:00Z');
    const make = (branchId: string | null) =>
      owner.doctorFee.create({
        data: {
          tenantId: A.h.tenant,
          doctorProfileId: A.docBoth,
          branchId,
          visitType: 'NEW',
          amountPaise: 1,
          effectiveFrom: at,
          createdBy: A.staffId,
        },
      });
    await make(A.h.east);
    await expect(make(A.h.east)).rejects.toThrow();
    await make(null);
    await expect(make(null)).rejects.toThrow();
  });

  it('audit holds ids and amounts only, with the branch id', async () => {
    const res = await setFee(A.sa, {
      doctorProfileId: A.docOnlyNew,
      visitType: 'NEW',
      amountPaise: 61_000,
      branchId: A.h.east,
    }).expect(200);
    const row = await owner.auditLog.findFirstOrThrow({
      where: { tenantId: A.h.tenant, entityId: res.body.price.id },
    });
    expect(row.metadata).toMatchObject({ branchId: A.h.east, newAmountPaise: 61_000 });
    expect(Object.keys(row.metadata as object).sort()).toEqual([
      'branchId',
      'doctorProfileId',
      'effectiveFrom',
      'newAmountPaise',
      'oldAmountPaise',
      'visitType',
    ]);
  });
});
