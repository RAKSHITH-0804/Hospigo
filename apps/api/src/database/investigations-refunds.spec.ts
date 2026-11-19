import 'dotenv/config';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { Client } from 'pg';
import {
  createOwnerPrisma,
  createPgClient,
  requireTestDatabaseUrl,
  withTenant,
} from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

type Fixture = {
  tenant: string;
  main: string;
  east: string;
  requester: string;
  approver: string;
  doctorUser: string;
  otherDoctorUser: string;
  doctor: string;
  otherDoctor: string;
  fee: string;
  cash: string;
  upi: string;
  testA: string;
  testB: string;
  testOff: string;
  regItem: string;
};

type Paid = { visit: string; bill: string; payment: string; patient: string };

const FEE = 50_000;

describe('Tests ordered, investigations bill, refunds and cancelling (database rules, hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);

  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${stamp}-${(counter += 1)}`;
  let A: Fixture;
  let B: Fixture;

  async function seedHospital(label: string): Promise<Fixture> {
    const hospital = await owner.hospital.create({
      data: {
        code: `IRD_${label}_${stamp}`,
        name: `Inv Refund DB ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `ird-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `ird-${label}-e-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const user = (key: string) =>
      owner.user.create({
        data: {
          tenantId: tenant,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `ird_${key}_${label}_${stamp}@example.test`,
          displayName: key,
          passwordHash: 'x',
        },
      });
    const requester = await user('REQ');
    const approver = await user('APR');
    const doctorUser = await user('DOC');
    const otherDoctorUser = await user('DOC2');
    const doctor = await owner.doctorProfile.create({
      data: { tenantId: tenant, userId: doctorUser.id, code: `D1${label}${stamp}` },
    });
    const otherDoctor = await owner.doctorProfile.create({
      data: { tenantId: tenant, userId: otherDoctorUser.id, code: `D2${label}${stamp}` },
    });
    const fee = await owner.doctorFee.create({
      data: {
        tenantId: tenant,
        doctorProfileId: doctor.id,
        visitType: 'NEW',
        amountPaise: FEE,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        createdBy: requester.id,
      },
    });
    const item = async (
      code: string,
      kind: 'REGISTRATION' | 'INVESTIGATION',
      active = true,
    ): Promise<string> =>
      (
        await owner.chargeItem.create({
          data: { tenantId: tenant, code, name: `Name ${code}`, kind, active },
        })
      ).id;
    const mode = (code: string, requiresReference: boolean) =>
      owner.paymentMode.create({
        data: { tenantId: tenant, code, name: code, requiresReference },
      });
    return {
      tenant,
      main: hospital.branches.find((b) => b.code === 'MAIN')!.id,
      east: hospital.branches.find((b) => b.code === 'EAST')!.id,
      requester: requester.id,
      approver: approver.id,
      doctorUser: doctorUser.id,
      otherDoctorUser: otherDoctorUser.id,
      doctor: doctor.id,
      otherDoctor: otherDoctor.id,
      fee: fee.id,
      cash: (await mode('CASH', false)).id,
      upi: (await mode('UPI', true)).id,
      testA: await item('TA', 'INVESTIGATION'),
      testB: await item('TB', 'INVESTIGATION'),
      testOff: await item('TOFF', 'INVESTIGATION', false),
      regItem: await item('REGX', 'REGISTRATION'),
    };
  }

  beforeAll(async () => {
    A = await seedHospital('A');
    B = await seedHospital('B');
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  // ------------------------------------------------------------------------------- helpers

  async function inTenant<T>(tenant: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createPgClient('app');
    await c.connect();
    try {
      return await withTenant(c, tenant, () => fn(c));
    } finally {
      await c.end();
    }
  }

  async function asOwner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createPgClient('owner');
    await c.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      await c.end();
    }
  }

  const refused = (p: Promise<unknown>, pattern: RegExp) => expect(p).rejects.toThrow(pattern);

  let tokenSeq = 0;

  /** A paid consultation (cash, or UPI) for a new patient, moved to the stage asked for. */
  async function paidVisit(
    f: Fixture,
    o: {
      stage?: 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED';
      branch?: string;
      mode?: 'cash' | 'upi';
    } = {},
  ): Promise<Paid> {
    const branch = o.branch ?? f.main;
    const patient = (
      await owner.patient.create({
        data: {
          tenantId: f.tenant,
          uhid: unique('P'),
          registeredBranchId: f.main,
          name: 'Patient',
          createdBy: f.requester,
        },
      })
    ).id;
    const visit = randomUUID();
    const bill = randomUUID();
    const receipt = randomUUID();
    const payment = randomUUID();
    const stage = o.stage ?? 'WAITING';
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO opd_visits (id, tenant_id, branch_id, patient_id, doctor_profile_id, visit_type,
                                 visit_date, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'NEW', CURRENT_DATE, $6, now())`,
        [visit, f.tenant, branch, patient, f.doctor, f.requester],
      );
      await c.query(
        `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                            tax_paise, total_paise, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'CONSULTATION', $5, $6, 0, $6, $7, $8)`,
        [bill, f.tenant, branch, visit, unique('BILL'), FEE, unique('BK'), f.requester],
      );
      await c.query(
        `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, doctor_fee_id, code_snapshot,
                                 description_snapshot, quantity, unit_price_paise, tax_rate_bp,
                                 tax_paise, line_total_paise)
         VALUES ($1, $2, $3, 1, 'CONSULTATION', $4, 'C', 'D', 1, $5, 0, 0, $5)`,
        [randomUUID(), f.tenant, bill, f.fee, FEE],
      );
      await c.query(
        `INSERT INTO receipts (id, tenant_id, branch_id, bill_id, receipt_number, total_paise,
                               issued_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [receipt, f.tenant, branch, bill, unique('RC'), FEE, f.requester, unique('RK')],
      );
      await c.query(
        `INSERT INTO payments (id, tenant_id, bill_id, branch_id, receipt_id, payment_mode_id,
                               amount_paise, reference_no, received_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          payment,
          f.tenant,
          bill,
          branch,
          receipt,
          o.mode === 'upi' ? f.upi : f.cash,
          FEE,
          o.mode === 'upi' ? 'U-1' : null,
          f.requester,
          unique('PK'),
        ],
      );
      tokenSeq += 1;
      await c.query(
        `UPDATE opd_visits SET status='WAITING', token_date=CURRENT_DATE, token_no=$2, queued_at=now(),
                               updated_at=now() WHERE id=$1`,
        [visit, tokenSeq],
      );
      if (stage !== 'WAITING') {
        await c.query(
          `UPDATE opd_visits SET status='IN_CONSULTATION', consultation_started_at=now(), updated_at=now()
            WHERE id=$1`,
          [visit],
        );
      }
      if (stage === 'COMPLETED') {
        await c.query(
          `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id, complaints)
           VALUES ($1, $2, $3, $4, $5, 'cough')`,
          [randomUUID(), f.tenant, branch, visit, f.doctor],
        );
        await c.query(
          `UPDATE consultations SET status='COMPLETED', completed_at=now() WHERE visit_id=$1`,
          [visit],
        );
        await c.query(
          `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
          [visit],
        );
      }
    });
    return { visit, bill, payment, patient };
  }

  const insertOrder = (
    c: Client,
    f: Fixture,
    o: {
      visit: string;
      item?: string;
      code?: string;
      name?: string;
      doctor?: string;
      orderedBy?: string;
      status?: string;
    },
  ) => {
    const id = randomUUID();
    const item = o.item ?? f.testA;
    return c
      .query(
        `INSERT INTO investigation_orders (id, tenant_id, branch_id, visit_id, doctor_profile_id,
                charge_item_id, code_snapshot, name_snapshot, status, ordered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::investigation_order_status, $10)`,
        [
          id,
          f.tenant,
          f.main,
          o.visit,
          o.doctor ?? f.doctor,
          item,
          o.code ?? (item === f.testB ? 'TB' : item === f.testOff ? 'TOFF' : 'TA'),
          o.name ?? (item === f.testB ? 'Name TB' : item === f.testOff ? 'Name TOFF' : 'Name TA'),
          o.status ?? 'ORDERED',
          o.orderedBy ?? f.doctorUser,
        ],
      )
      .then(() => id);
  };

  /** Bill one ordered test (bill + line + link + receipt + payment) in one transaction. */
  async function billOrder(
    f: Fixture,
    visit: string,
    order: string,
    item?: string,
    amount = 30_000,
  ): Promise<{ bill: string; payment: string }> {
    const bill = randomUUID();
    const line = randomUUID();
    const receipt = randomUUID();
    const payment = randomUUID();
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                            tax_paise, total_paise, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'INVESTIGATION', $5, $6, 0, $6, $7, $8)`,
        [bill, f.tenant, f.main, visit, unique('IB'), amount, unique('IBK'), f.requester],
      );
      await c.query(
        `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, charge_item_id, code_snapshot,
                                 description_snapshot, quantity, unit_price_paise, tax_rate_bp,
                                 tax_paise, line_total_paise)
         VALUES ($1, $2, $3, 1, 'INVESTIGATION', $4, 'T', 'T', 1, $5, 0, 0, $5)`,
        [line, f.tenant, bill, item ?? f.testA, amount],
      );
      await c.query(
        `UPDATE investigation_orders SET status='BILLED', bill_line_id=$2, resolved_by=$3, resolved_at=now()
          WHERE id=$1`,
        [order, line, f.requester],
      );
      await c.query(
        `INSERT INTO receipts (id, tenant_id, branch_id, bill_id, receipt_number, total_paise,
                               issued_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [receipt, f.tenant, f.main, bill, unique('RC'), amount, f.requester, unique('RK')],
      );
      await c.query(
        `INSERT INTO payments (id, tenant_id, bill_id, branch_id, receipt_id, payment_mode_id,
                               amount_paise, received_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [payment, f.tenant, bill, f.main, receipt, f.cash, amount, f.requester, unique('PK')],
      );
    });
    return { bill, payment };
  }

  const insertRequest = (
    c: Client,
    f: Fixture,
    o: {
      bill: string;
      visit: string;
      type?: 'REFUND' | 'CANCEL_VISIT';
      amount: number;
      by?: string;
      key?: string;
      branch?: string;
    },
  ) => {
    const id = randomUUID();
    return c
      .query(
        `INSERT INTO refund_requests (id, tenant_id, branch_id, bill_id, visit_id, request_type,
                amount_paise, reason, requested_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6::refund_request_type, $7, 'because', $8, $9)`,
        [
          id,
          f.tenant,
          o.branch ?? f.main,
          o.bill,
          o.visit,
          o.type ?? 'REFUND',
          o.amount,
          o.by ?? f.requester,
          o.key ?? unique('RQ'),
        ],
      )
      .then(() => id);
  };

  const approveSql = (c: Client, f: Fixture, id: string, number: string | null = unique('RF')) =>
    c.query(
      `UPDATE refund_requests SET status='APPROVED', decided_by=$2, decided_at=now(), refund_number=$3
        WHERE id=$1`,
      [id, f.approver, number],
    );

  const insertRefund = (
    c: Client,
    f: Fixture,
    o: {
      request: string;
      bill: string;
      payment: string;
      amount: number;
      mode?: string;
      by?: string;
      reference?: string | null;
    },
  ) =>
    c.query(
      `INSERT INTO refunds (id, tenant_id, branch_id, bill_id, request_id, payment_id,
                            payment_mode_id, amount_paise, reference_no, refunded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        f.tenant,
        f.main,
        o.bill,
        o.request,
        o.payment,
        o.mode ?? f.cash,
        o.amount,
        o.reference ?? null,
        o.by ?? f.approver,
      ],
    );

  const billState = (f: Fixture, bill: string) =>
    inTenant(f.tenant, async (c) => {
      const r = await c.query<{ refunded: number; paid: number }>(
        `SELECT refunded_paise AS refunded, paid_paise AS paid FROM bills WHERE id = $1`,
        [bill],
      );
      return r.rows[0]!;
    });

  /** Asks (as the app role) and approves (as another user) a refund in one transaction. */
  async function approvedRefund(
    f: Fixture,
    p: Paid,
    amount: number,
    type: 'REFUND' | 'CANCEL_VISIT' = 'REFUND',
  ): Promise<string> {
    return inTenant(f.tenant, async (c) => {
      const id = await insertRequest(c, f, { bill: p.bill, visit: p.visit, amount, type });
      await approveSql(c, f, id, amount > 0 ? unique('RF') : null);
      if (amount > 0) {
        await insertRefund(c, f, { request: id, bill: p.bill, payment: p.payment, amount });
      }
      if (type === 'CANCEL_VISIT') {
        await c.query(
          `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='x', updated_at=now()
            WHERE id=$1`,
          [p.visit],
        );
      }
      return id;
    });
  }

  // ------------------------------------------------------------------- investigation orders

  describe('investigation orders', () => {
    it('are created only while the visit is in consultation', async () => {
      const waiting = await paidVisit(A, { stage: 'WAITING' });
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: waiting.visit })),
        /in consultation/i,
      );
      const done = await paidVisit(A, { stage: 'COMPLETED' });
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: done.visit })),
        /in consultation/i,
      );
      const open = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      await expect(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: open.visit })),
      ).resolves.toBeTruthy();
    });

    it('belong to the visit doctor: another doctor, or another ordering user, is refused', async () => {
      const v = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      await refused(
        inTenant(A.tenant, (c) =>
          insertOrder(c, A, {
            visit: v.visit,
            doctor: A.otherDoctor,
            orderedBy: A.otherDoctorUser,
          }),
        ),
        /doctor of the visit/i,
      );
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit, orderedBy: A.requester })),
        /doctor of the visit/i,
      );
    });

    it('need an active TEST of the hospital list, copied exactly; one per test per visit', async () => {
      const v = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit, item: A.testOff })),
        /active test/i,
      );
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit, item: A.regItem })),
        /active test/i,
      );
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit, name: 'Something else' })),
        /true copy/i,
      );
      // another hospital's test is invisible (row level security + composite key)
      await expect(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit, item: B.testA })),
      ).rejects.toThrow();
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit, status: 'BILLED' })),
        /starts as ORDERED|violates check|ORDERED/i,
      );
      await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit }));
      await refused(
        inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit })),
        /duplicate key|unique/i,
      );
    });

    it('move on once: NOT_TAKEN needs a reason; a resolved order never changes; identity is fixed', async () => {
      const v = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      const id = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit }));
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE investigation_orders SET status='NOT_TAKEN', resolved_by=$2, resolved_at=now() WHERE id=$1`,
            [id, A.requester],
          ),
        ),
        /check constraint/i,
      );
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(`UPDATE investigation_orders SET code_snapshot='X' WHERE id=$1`, [id]),
        ),
        /permission denied|immutable/i,
      );
      await inTenant(A.tenant, (c) =>
        c.query(
          `UPDATE investigation_orders SET status='NOT_TAKEN', not_taken_reason='elsewhere',
                  resolved_by=$2, resolved_at=now() WHERE id=$1`,
          [id, A.requester],
        ),
      );
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE investigation_orders SET status='NOT_TAKEN', not_taken_reason='again',
                    resolved_by=$2, resolved_at=now() WHERE id=$1`,
            [id, A.requester],
          ),
        ),
        /cannot change/i,
      );
    });

    it('BILLED must point to its own line on an investigations bill of the same visit and test', async () => {
      const v = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      const other = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      const order = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit }));
      const otherOrder = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: other.visit }));
      const wrongBill = await billOrder(A, other.visit, otherOrder);
      const wrongLine = (
        await inTenant(A.tenant, (c) =>
          c.query<{ id: string }>(`SELECT id FROM bill_lines WHERE bill_id=$1`, [wrongBill.bill]),
        )
      ).rows[0]!.id;
      // a line of ANOTHER visit's bill
      await refused(
        asOwner((c) =>
          c.query(
            `UPDATE investigation_orders SET status='BILLED', bill_line_id=$2, resolved_by=$3, resolved_at=now()
              WHERE id=$1`,
            [order, wrongLine, A.requester],
          ),
        ),
        /its own line/i,
      );
      // a line on the CONSULTATION bill
      const consultLine = (
        await inTenant(A.tenant, (c) =>
          c.query<{ id: string }>(`SELECT id FROM bill_lines WHERE bill_id=$1`, [v.bill]),
        )
      ).rows[0]!.id;
      await refused(
        asOwner((c) =>
          c.query(
            `UPDATE investigation_orders SET status='BILLED', bill_line_id=$2, resolved_by=$3, resolved_at=now()
              WHERE id=$1`,
            [order, consultLine, A.requester],
          ),
        ),
        /its own line/i,
      );
    });

    it('can be removed only while ORDERED and the visit is still in consultation', async () => {
      const v = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      const gone = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: v.visit }));
      await inTenant(A.tenant, (c) =>
        c.query(`DELETE FROM investigation_orders WHERE id=$1`, [gone]),
      );
      const billed = await inTenant(A.tenant, (c) =>
        insertOrder(c, A, { visit: v.visit, item: A.testB }),
      );
      await billOrder(A, v.visit, billed, A.testB);
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(`DELETE FROM investigation_orders WHERE id=$1`, [billed]),
        ),
        /cannot be removed/i,
      );
      const late = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      const lateOrder = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: late.visit }));
      await asOwner(async (c) => {
        await c.query(
          `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id, complaints)
           VALUES ($1, $2, $3, $4, $5, 'x')`,
          [randomUUID(), A.tenant, A.main, late.visit, A.doctor],
        );
        await c.query(
          `UPDATE consultations SET status='COMPLETED', completed_at=now() WHERE visit_id=$1`,
          [late.visit],
        );
        await c.query(
          `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
          [late.visit],
        );
      });
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(`DELETE FROM investigation_orders WHERE id=$1`, [lateOrder]),
        ),
        /still in consultation|in consultation/i,
      );
      await refused(
        asOwner((c) => c.query(`TRUNCATE investigation_orders`)),
        /cannot|refus|not allowed/i,
      );
    });
  });

  // ------------------------------------------------------------------ investigations bill

  describe('investigations bill', () => {
    it('only for a visit that is in consultation or completed; never for a waiting visit', async () => {
      const waiting = await paidVisit(A, { stage: 'WAITING' });
      await refused(
        asOwner((c) =>
          c.query(
            `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                                tax_paise, total_paise, idempotency_key, created_by)
             VALUES ($1, $2, $3, $4, 'INVESTIGATION', $5, 0, 0, 0, $6, $7)`,
            [
              randomUUID(),
              A.tenant,
              A.main,
              waiting.visit,
              unique('IB'),
              unique('IBK'),
              A.requester,
            ],
          ),
        ),
        /in consultation or completed/i,
      );
      const done = await paidVisit(A, { stage: 'COMPLETED' });
      // orders can only be created in consultation, so create it first and complete after
      const open = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      const order = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: open.visit }));
      await billOrder(A, open.visit, order);
      expect(done.visit).toBeTruthy();
    });

    it('every line is a test the doctor ordered, and tests never sit on a consultation bill', async () => {
      const v = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      // a test line with no order behind it: refused at commit
      await refused(
        asOwner(async (c) => {
          const bill = randomUUID();
          await c.query(
            `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                                tax_paise, total_paise, idempotency_key, created_by)
             VALUES ($1, $2, $3, $4, 'INVESTIGATION', $5, 100, 0, 100, $6, $7)`,
            [bill, A.tenant, A.main, v.visit, unique('IB'), unique('IBK'), A.requester],
          );
          await c.query(
            `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, charge_item_id, code_snapshot,
                                     description_snapshot, quantity, unit_price_paise, tax_rate_bp,
                                     tax_paise, line_total_paise)
             VALUES ($1, $2, $3, 1, 'INVESTIGATION', $4, 'T', 'T', 1, 100, 0, 0, 100)`,
            [randomUUID(), A.tenant, bill, A.testA],
          );
        }),
        /test the doctor ordered/i,
      );
      // a test line on the consultation bill: refused
      await refused(
        asOwner(async (c) => {
          await c.query(`UPDATE bills SET bill_number = bill_number WHERE id = $1`, [v.bill]);
          await c.query(
            `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, charge_item_id, code_snapshot,
                                     description_snapshot, quantity, unit_price_paise, tax_rate_bp,
                                     tax_paise, line_total_paise)
             VALUES ($1, $2, $3, 5, 'INVESTIGATION', $4, 'T', 'T', 1, 100, 0, 0, 100)`,
            [randomUUID(), A.tenant, v.bill, A.testA],
          );
        }),
        /belongs on an investigations bill|sum of its lines|immutable|append-only|cannot/i,
      );
    });
  });

  // -------------------------------------------------------------------------- refund requests

  describe('refund requests', () => {
    it('cannot ask for more than paid, nor for more than what open requests leave', async () => {
      const p = await paidVisit(A);
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: FEE + 1 }),
        ),
        /more than what was paid/i,
      );
      await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 40_000 }),
      );
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 10_001 }),
        ),
        /open requests already cover/i,
      );
      await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 10_000 }),
      );
    });

    it('a REFUND needs money; only a cancellation may be zero; the bill must belong to the visit and branch', async () => {
      const p = await paidVisit(A);
      const q = await paidVisit(A);
      await refused(
        inTenant(A.tenant, (c) => insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 0 })),
        /check constraint/i,
      );
      await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 0, type: 'CANCEL_VISIT' }),
      );
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: q.visit, amount: 100 }),
        ),
        /not a bill of this visit/i,
      );
      await expect(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 100, branch: A.east }),
        ),
      ).rejects.toThrow();
    });

    it('no refund of the consultation bill once the consultation started; a cancellation needs a WAITING visit', async () => {
      const started = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: started.bill, visit: started.visit, amount: 100 }),
        ),
        /consultation has started/i,
      );
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, {
            bill: started.bill,
            visit: started.visit,
            amount: 0,
            type: 'CANCEL_VISIT',
          }),
        ),
        /consultation has started/i,
      );
      // an investigations bill is still refundable after the consultation started
      const order = await inTenant(A.tenant, (c) => insertOrder(c, A, { visit: started.visit }));
      const tests = await billOrder(A, started.visit, order);
      await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: tests.bill, visit: started.visit, amount: 100 }),
      );
      // a cancellation goes through the CONSULTATION bill only
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, {
            bill: tests.bill,
            visit: started.visit,
            amount: 0,
            type: 'CANCEL_VISIT',
          }),
        ),
        /consultation bill|only a waiting visit/i,
      );
    });

    it('only the decision columns can change; the asker cannot decide; a decided request is frozen', async () => {
      const p = await paidVisit(A);
      const id = await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 5_000 }),
      );
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(`UPDATE refund_requests SET amount_paise = 1 WHERE id=$1`, [id]),
        ),
        /permission denied/i,
      );
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE refund_requests SET status='APPROVED', decided_by=requested_by, decided_at=now(),
                    refund_number='X' WHERE id=$1`,
            [id],
          ),
        ),
        /who asked cannot decide|check constraint/i,
      );
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE refund_requests SET status='REJECTED', decided_by=$2, decided_at=now() WHERE id=$1`,
            [id, A.approver],
          ),
        ),
        /check constraint/i, // a rejection needs a note
      );
      await inTenant(A.tenant, (c) =>
        c.query(
          `UPDATE refund_requests SET status='REJECTED', decided_by=$2, decided_at=now(), decision_note='no'
            WHERE id=$1`,
          [id, A.approver],
        ),
      );
      await refused(
        inTenant(A.tenant, (c) => approveSql(c, A, id)),
        /decided request cannot change/i,
      );
      await refused(
        asOwner((c) => c.query(`DELETE FROM refund_requests WHERE id=$1`, [id])),
        /cannot|not allowed|refus|append-only/i,
      );
      // an approved request needs a voucher number exactly when money moves
      const q = await paidVisit(A);
      const withMoney = await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: q.bill, visit: q.visit, amount: 100 }),
      );
      await refused(
        inTenant(A.tenant, (c) => approveSql(c, A, withMoney, null)),
        /check constraint/i,
      );
    });

    it('same key twice is refused (idempotency); another hospital cannot see or use the request', async () => {
      const p = await paidVisit(A);
      const key = unique('SAMEKEY');
      await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 10, key }),
      );
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 10, key }),
        ),
        /duplicate key|unique/i,
      );
      const seen = await inTenant(B.tenant, (c) =>
        c.query(`SELECT count(*)::int AS n FROM refund_requests WHERE tenant_id=$1`, [A.tenant]),
      );
      expect(seen.rows[0].n).toBe(0);
      await expect(
        inTenant(B.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 10 }),
        ),
      ).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------------------------- refunds

  describe('refunds', () => {
    it('are written only for an APPROVED request, by the approver, and equal the request at commit', async () => {
      const p = await paidVisit(A);
      // a refund for a request that is still only REQUESTED
      const open = await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 1_000 }),
      );
      await refused(
        asOwner((c) =>
          insertRefund(c, A, { request: open, bill: p.bill, payment: p.payment, amount: 1_000 }),
        ),
        /approved request/i,
      );
      // approved but nobody wrote the refund rows: refused at commit
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, open);
        }),
        /sum of its refunds/i,
      );
      // refund of a different amount than approved
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, open);
          await insertRefund(c, A, {
            request: open,
            bill: p.bill,
            payment: p.payment,
            amount: 900,
          });
        }),
        /sum of its refunds/i,
      );
      // not by the approver
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, open);
          await insertRefund(c, A, {
            request: open,
            bill: p.bill,
            payment: p.payment,
            amount: 1_000,
            by: A.requester,
          });
        }),
        /person who approved/i,
      );
      // all correct
      await inTenant(A.tenant, async (c) => {
        await approveSql(c, A, open);
        await insertRefund(c, A, {
          request: open,
          bill: p.bill,
          payment: p.payment,
          amount: 1_000,
        });
      });
      expect(await billState(A, p.bill)).toEqual({ refunded: 1_000, paid: FEE });
    });

    it('follow the original payment mode and never return more than that payment received', async () => {
      const p = await paidVisit(A, { mode: 'upi' });
      const id = await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 20_000 }),
      );
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, id);
          await insertRefund(c, A, {
            request: id,
            bill: p.bill,
            payment: p.payment,
            amount: 20_000,
            mode: A.cash,
          });
        }),
        /original payment mode/i,
      );
      // a UPI refund needs its reference
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, id);
          await insertRefund(c, A, {
            request: id,
            bill: p.bill,
            payment: p.payment,
            amount: 20_000,
            mode: A.upi,
          });
        }),
        /reference number is required/i,
      );
      await inTenant(A.tenant, async (c) => {
        await approveSql(c, A, id);
        await insertRefund(c, A, {
          request: id,
          bill: p.bill,
          payment: p.payment,
          amount: 20_000,
          mode: A.upi,
          reference: 'R-1',
        });
      });
      // 20 000 already returned: another 30 001 would be more than the payment received
      const more = await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 30_000 }),
      );
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, more);
          await insertRefund(c, A, {
            request: more,
            bill: p.bill,
            payment: p.payment,
            amount: 30_001,
            mode: A.upi,
            reference: 'R-2',
          });
        }),
        /more than that payment|more than the bill|check constraint|sum of its refunds/i,
      );
      expect(await billState(A, p.bill)).toEqual({ refunded: 20_000, paid: FEE });
    });

    it('write their REFUND ledger row; the bill is recalculated, never edited; rows are append-only', async () => {
      const p = await paidVisit(A);
      const id = await approvedRefund(A, p, 12_000);
      const ledger = await inTenant(A.tenant, (c) =>
        c.query<{ entry_type: string; amount_paise: number }>(
          `SELECT entry_type, amount_paise FROM ledger_entries WHERE bill_id=$1 ORDER BY entry_type`,
          [p.bill],
        ),
      );
      expect(ledger.rows.map((r) => [r.entry_type, r.amount_paise])).toEqual([
        ['CHARGE', FEE],
        ['PAYMENT', FEE],
        ['REFUND', 12_000],
      ]);
      expect(await billState(A, p.bill)).toEqual({ refunded: 12_000, paid: FEE });
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(`UPDATE bills SET refunded_paise = 0 WHERE id=$1`, [p.bill]),
        ),
        /permission denied|ledger/i,
      );
      await refused(
        asOwner((c) => c.query(`UPDATE refunds SET amount_paise = 1 WHERE request_id=$1`, [id])),
        /cannot|not allowed|refus|append/i,
      );
      await refused(
        asOwner((c) => c.query(`DELETE FROM refunds WHERE request_id=$1`, [id])),
        /cannot|not allowed|refus|append/i,
      );
      await refused(
        asOwner((c) => c.query(`TRUNCATE refunds`)),
        /cannot|not allowed|refus|append/i,
      );
    });

    it('never exceed what is left of the bill, in total', async () => {
      const p = await paidVisit(A);
      await approvedRefund(A, p, 30_000);
      const rest = await inTenant(A.tenant, (c) =>
        insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 20_000 }),
      );
      await refused(
        inTenant(A.tenant, async (c) => {
          await approveSql(c, A, rest);
          await insertRefund(c, A, {
            request: rest,
            bill: p.bill,
            payment: p.payment,
            amount: 20_001,
          });
        }),
        /sum of its refunds|more than/i,
      );
      // the right amount for the same request goes through
      await inTenant(A.tenant, async (c) => {
        await approveSql(c, A, rest);
        await insertRefund(c, A, {
          request: rest,
          bill: p.bill,
          payment: p.payment,
          amount: 20_000,
        });
      });
      expect(await billState(A, p.bill)).toEqual({ refunded: FEE, paid: FEE });
    });

    it('hospital B cannot write a refund on hospital A, and hospital B sees none of it', async () => {
      const p = await paidVisit(A);
      const id = await approvedRefund(A, p, 1_000);
      const seen = await inTenant(B.tenant, (c) =>
        c.query(`SELECT count(*)::int AS n FROM refunds WHERE tenant_id=$1`, [A.tenant]),
      );
      expect(seen.rows[0].n).toBe(0);
      await expect(
        inTenant(B.tenant, (c) =>
          insertRefund(c, A, { request: id, bill: p.bill, payment: p.payment, amount: 10 }),
        ),
      ).rejects.toThrow();
    });

    it('hospigo_hq and hospigo_patient have no privileges on the new tables', async () => {
      await asOwner(async (c) => {
        for (const role of ['hospigo_hq', 'hospigo_patient']) {
          for (const table of ['investigation_orders', 'refund_requests', 'refunds']) {
            const r = await c.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
              `SELECT has_table_privilege($1, $2, 'SELECT') AS s,
                      has_table_privilege($1, $2, 'INSERT') AS i,
                      has_table_privilege($1, $2, 'UPDATE') AS u,
                      has_table_privilege($1, $2, 'DELETE') AS d`,
              [role, `public.${table}`],
            );
            expect({ role, table, ...r.rows[0] }).toEqual({
              role,
              table,
              s: false,
              i: false,
              u: false,
              d: false,
            });
          }
        }
        const rls = await c.query<{ relname: string; on: boolean; forced: boolean }>(
          `SELECT relname, relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class
            WHERE relname IN ('investigation_orders','refund_requests','refunds')`,
        );
        expect(rls.rows).toHaveLength(3);
        for (const row of rls.rows) {
          expect({ row: row.relname, on: row.on, forced: row.forced }).toEqual({
            row: row.relname,
            on: true,
            forced: true,
          });
        }
      });
    });
  });

  // ----------------------------------------------------------------------------- cancelling

  describe('cancelling a waiting visit', () => {
    it('is possible only through an approved cancellation request', async () => {
      const p = await paidVisit(A);
      const cancel = (c: Client) =>
        c.query(
          `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='x', updated_at=now()
            WHERE id=$1`,
          [p.visit],
        );
      await refused(inTenant(A.tenant, cancel), /approved cancellation request/i);
      // a plain REFUND request, even approved, does not allow it
      await refused(
        inTenant(A.tenant, async (c) => {
          const id = await insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 100 });
          await approveSql(c, A, id);
          await insertRefund(c, A, { request: id, bill: p.bill, payment: p.payment, amount: 100 });
          await cancel(c);
        }),
        /approved cancellation request/i,
      );
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: p.visit } })).status).toBe(
        'WAITING',
      );
      await approvedRefund(A, p, FEE, 'CANCEL_VISIT');
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: p.visit } })).status).toBe(
        'CANCELLED',
      );
      expect(await billState(A, p.bill)).toEqual({ refunded: FEE, paid: FEE });
    });

    it('an approved cancellation must leave the visit cancelled (checked at commit)', async () => {
      const p = await paidVisit(A);
      await refused(
        inTenant(A.tenant, async (c) => {
          const id = await insertRequest(c, A, {
            bill: p.bill,
            visit: p.visit,
            amount: 0,
            type: 'CANCEL_VISIT',
          });
          await approveSql(c, A, id, null);
        }),
        /leave the visit cancelled/i,
      );
      expect((await owner.opdVisit.findUniqueOrThrow({ where: { id: p.visit } })).status).toBe(
        'WAITING',
      );
    });

    it('once the consultation started, the visit can no longer be cancelled by any request', async () => {
      const p = await paidVisit(A, { stage: 'IN_CONSULTATION' });
      await refused(
        inTenant(A.tenant, (c) =>
          insertRequest(c, A, { bill: p.bill, visit: p.visit, amount: 0, type: 'CANCEL_VISIT' }),
        ),
        /consultation has started/i,
      );
      await refused(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='x', updated_at=now()
              WHERE id=$1`,
            [p.visit],
          ),
        ),
        /cannot go from IN_CONSULTATION|visit status/i,
      );
    });
  });
});
