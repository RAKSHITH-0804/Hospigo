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

const FEE = 50_000;
const REG = 10_000;

type Fixture = {
  tenant: string;
  main: string;
  east: string;
  user: string;
  approver: string;
  doctor: string;
  fee: string;
  cash: string;
  regItem: string;
};
type Visit = { visit: string; bill: string; payment: string; patient: string; fee: string };

describe('Registration fee voided by a refunded cancellation (database rules, hospigo_test)', () => {
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
        code: `RFV_${label}_${stamp}`,
        name: `Reg Fee Void ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `rfv-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `rfv-${label}-e-${stamp}` },
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
          email: `rfv_${key}_${label}_${stamp}@example.test`,
          displayName: key,
          passwordHash: 'x',
        },
      });
    const requester = await user('REQ');
    const approver = await user('APR');
    const doctorUser = await user('DOC');
    const doctor = await owner.doctorProfile.create({
      data: { tenantId: tenant, userId: doctorUser.id, code: `D1${label}${stamp}` },
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
    const regItem = await owner.chargeItem.create({
      data: { tenantId: tenant, code: `REG${label}`, name: 'Registration', kind: 'REGISTRATION' },
    });
    const cash = await owner.paymentMode.create({
      data: { tenantId: tenant, code: 'CASH', name: 'CASH', requiresReference: false },
    });
    return {
      tenant,
      main: hospital.branches.find((b) => b.code === 'MAIN')!.id,
      east: hospital.branches.find((b) => b.code === 'EAST')!.id,
      user: requester.id,
      approver: approver.id,
      doctor: doctor.id,
      fee: fee.id,
      cash: cash.id,
      regItem: regItem.id,
    };
  }

  beforeAll(async () => {
    A = await seedHospital('A');
    B = await seedHospital('B');
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  async function connect(role: 'app' | 'owner'): Promise<Client> {
    const c = createPgClient(role);
    await c.connect();
    return c;
  }

  async function inTenant<T>(tenant: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await connect('app');
    try {
      return await withTenant(c, tenant, () => fn(c));
    } finally {
      await c.end();
    }
  }

  async function asOwner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await connect('owner');
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

  async function newPatient(f: Fixture): Promise<string> {
    return (
      await owner.patient.create({
        data: {
          tenantId: f.tenant,
          uhid: unique('P'),
          registeredBranchId: f.main,
          name: 'Patient',
          createdBy: f.user,
        },
      })
    ).id;
  }

  /**
   * A paid WAITING visit. With `registration` the bill also carries the REGISTRATION line and its
   * fee record (the patient's first visit); without it the bill is consultation only.
   */
  async function paidVisit(
    f: Fixture,
    o: { patient?: string; registration?: boolean } = {},
  ): Promise<Visit> {
    const patient = o.patient ?? (await newPatient(f));
    const registration = o.registration ?? true;
    const total = FEE + (registration ? REG : 0);
    const visit = randomUUID();
    const bill = randomUUID();
    const receipt = randomUUID();
    const payment = randomUUID();
    const regLine = randomUUID();
    const fee = randomUUID();
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO opd_visits (id, tenant_id, branch_id, patient_id, doctor_profile_id, visit_type,
                                 visit_date, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'NEW', CURRENT_DATE, $6, now())`,
        [visit, f.tenant, f.main, patient, f.doctor, f.user],
      );
      await c.query(
        `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                            tax_paise, total_paise, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'CONSULTATION', $5, $6, 0, $6, $7, $8)`,
        [bill, f.tenant, f.main, visit, unique('BILL'), total, unique('BK'), f.user],
      );
      await c.query(
        `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, doctor_fee_id, code_snapshot,
                                 description_snapshot, quantity, unit_price_paise, tax_rate_bp,
                                 tax_paise, line_total_paise)
         VALUES ($1, $2, $3, 1, 'CONSULTATION', $4, 'C', 'D', 1, $5, 0, 0, $5)`,
        [randomUUID(), f.tenant, bill, f.fee, FEE],
      );
      if (registration) {
        await c.query(
          `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, charge_item_id, code_snapshot,
                                   description_snapshot, quantity, unit_price_paise, tax_rate_bp,
                                   tax_paise, line_total_paise)
           VALUES ($1, $2, $3, 2, 'REGISTRATION', $4, 'R', 'R', 1, $5, 0, 0, $5)`,
          [regLine, f.tenant, bill, f.regItem, REG],
        );
        await c.query(
          `INSERT INTO patient_registration_fees (id, tenant_id, patient_id, bill_line_id)
           VALUES ($1, $2, $3, $4)`,
          [fee, f.tenant, patient, regLine],
        );
      }
      await c.query(
        `INSERT INTO receipts (id, tenant_id, branch_id, bill_id, receipt_number, total_paise,
                               issued_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [receipt, f.tenant, f.main, bill, unique('RC'), total, f.user, unique('RK')],
      );
      await c.query(
        `INSERT INTO payments (id, tenant_id, bill_id, branch_id, receipt_id, payment_mode_id,
                               amount_paise, received_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [payment, f.tenant, bill, f.main, receipt, f.cash, total, f.user, unique('PK')],
      );
      tokenSeq += 1;
      await c.query(
        `UPDATE opd_visits SET status='WAITING', token_date=CURRENT_DATE, token_no=$2, queued_at=now(),
                               updated_at=now() WHERE id=$1`,
        [visit, tokenSeq],
      );
    });
    return { visit, bill, payment, patient, fee: registration ? fee : '' };
  }

  /** Ask for a cancellation, approve it, refund `amount` and cancel the visit, in one transaction. */
  async function cancel(
    f: Fixture,
    v: Visit,
    amount: number,
    o: { branch?: string; tenantForSession?: string } = {},
  ): Promise<void> {
    await inTenant(o.tenantForSession ?? f.tenant, async (c) => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO refund_requests (id, tenant_id, branch_id, bill_id, visit_id, request_type,
                amount_paise, reason, requested_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'CANCEL_VISIT', $6, 'because', $7, $8)`,
        [id, f.tenant, o.branch ?? f.main, v.bill, v.visit, amount, f.user, unique('RQ')],
      );
      await c.query(
        `UPDATE refund_requests SET status='APPROVED', decided_by=$2, decided_at=now(), refund_number=$3
          WHERE id=$1`,
        [id, f.approver, amount > 0 ? unique('RF') : null],
      );
      if (amount > 0) {
        await c.query(
          `INSERT INTO refunds (id, tenant_id, branch_id, bill_id, request_id, payment_id,
                                payment_mode_id, amount_paise, refunded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), f.tenant, f.main, v.bill, id, v.payment, f.cash, amount, f.approver],
        );
      }
      await c.query(
        `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='x', updated_at=now()
          WHERE id=$1`,
        [v.visit],
      );
    });
  }

  const feeRow = (id: string) => owner.patientRegistrationFee.findUniqueOrThrow({ where: { id } });

  it('a cancellation that refunds the WHOLE bill voids the fee of that visit, then the next visit can be charged again', async () => {
    const first = await paidVisit(A);
    await cancel(A, first, FEE + REG);
    const row = await feeRow(first.fee);
    const visit = await owner.opdVisit.findUniqueOrThrow({ where: { id: first.visit } });
    expect(row.voidedAt).not.toBeNull();
    // cancelled_at is set by the same update that sets CANCELLED, and the fee uses that very time
    expect(visit.cancelledAt).not.toBeNull();
    expect(row.voidedAt!.getTime()).toBe(visit.cancelledAt!.getTime());
    // the patient may now be charged again: a new active fee record is accepted
    const second = await paidVisit(A, { patient: first.patient });
    const active = await owner.patientRegistrationFee.findMany({
      where: { tenantId: A.tenant, patientId: first.patient, voidedAt: null },
    });
    expect(active.map((r) => r.id)).toEqual([second.fee]);
  });

  it('a PARTIAL refund or a zero-amount cancellation keeps the fee (never charged twice)', async () => {
    const partial = await paidVisit(A);
    await cancel(A, partial, FEE); // everything but the registration part
    expect((await feeRow(partial.fee)).voidedAt).toBeNull();
    const free = await paidVisit(A);
    await cancel(A, free, 0);
    expect((await feeRow(free.fee)).voidedAt).toBeNull();
    // the fee is still active, so a second active fee cannot exist (one per patient)
    await refused(
      paidVisit(A, { patient: partial.patient }),
      /patient_registration_fees_active_key|duplicate key/i,
    );
  });

  it('cancelling a visit that did not carry the fee leaves the patient fee alone', async () => {
    const first = await paidVisit(A);
    const repeat = await paidVisit(A, { patient: first.patient, registration: false }).catch(
      () => null,
    );
    expect(repeat).not.toBeNull();
    await cancel(A, repeat!, FEE);
    expect((await feeRow(first.fee)).voidedAt).toBeNull();
  });

  it('the application login still cannot update the fee table; the owner cannot change anything but voiding', async () => {
    const v = await paidVisit(A);
    await refused(
      inTenant(A.tenant, (c) =>
        c.query(`UPDATE patient_registration_fees SET voided_at = now() WHERE id = $1`, [v.fee]),
      ),
      /permission denied/i,
    );
    await refused(
      asOwner((c) =>
        c.query(`UPDATE patient_registration_fees SET charged_at = now() WHERE id = $1`, [v.fee]),
      ),
      /can only be voided/i,
    );
    await refused(
      asOwner((c) =>
        c.query(`UPDATE patient_registration_fees SET patient_id = $2 WHERE id = $1`, [
          v.fee,
          v.patient,
        ]),
      ),
      /nothing changed|can only be voided/i,
    );
    // voiding by hand is allowed once; un-voiding and re-voiding never
    await asOwner((c) =>
      c.query(`UPDATE patient_registration_fees SET voided_at = now() WHERE id = $1`, [v.fee]),
    );
    await refused(
      asOwner((c) =>
        c.query(`UPDATE patient_registration_fees SET voided_at = NULL WHERE id = $1`, [v.fee]),
      ),
      /voided registration fee cannot be changed/i,
    );
    await refused(
      asOwner((c) =>
        c.query(`UPDATE patient_registration_fees SET voided_at = now() WHERE id = $1`, [v.fee]),
      ),
      /voided registration fee cannot be changed/i,
    );
  });

  it('a replayed cancel is refused and changes nothing', async () => {
    const v = await paidVisit(A);
    await cancel(A, v, FEE + REG);
    const before = await feeRow(v.fee);
    await expect(cancel(A, v, FEE + REG)).rejects.toThrow();
    expect((await feeRow(v.fee)).voidedAt!.getTime()).toBe(before.voidedAt!.getTime());
  });

  it('two cancellations at the same moment: exactly one wins, the fee is voided once', async () => {
    const v = await paidVisit(A);
    const results = await Promise.allSettled([cancel(A, v, FEE + REG), cancel(A, v, FEE + REG)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await feeRow(v.fee)).voidedAt).not.toBeNull();
    const refunds = await owner.refund.findMany({ where: { billId: v.bill } });
    expect(refunds.reduce((sum, r) => sum + r.amountPaise, 0)).toBe(FEE + REG);
  });

  it('a cancellation asked from another branch of the same hospital is refused and the fee stays', async () => {
    const v = await paidVisit(A);
    await expect(cancel(A, v, FEE + REG, { branch: A.east })).rejects.toThrow();
    expect((await feeRow(v.fee)).voidedAt).toBeNull();
  });

  it('hospital B cannot cancel (or void anything of) hospital A', async () => {
    const v = await paidVisit(A);
    await expect(cancel(A, v, FEE + REG, { tenantForSession: B.tenant })).rejects.toThrow();
    expect((await feeRow(v.fee)).voidedAt).toBeNull();
    // even a trusted login that carries the wrong tenant is refused by the trigger itself
    await refused(
      asOwner(async (c) => {
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [B.tenant]);
        await c.query(`UPDATE opd_visits SET updated_at = now() WHERE id = $1 AND false`, [
          v.visit,
        ]);
        await c.query(`SELECT opd_assert_tenant($1)`, [A.tenant]);
      }),
      /tenant mismatch/i,
    );
  });
});
