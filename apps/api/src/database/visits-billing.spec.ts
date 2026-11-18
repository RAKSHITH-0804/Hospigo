import 'dotenv/config';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { Client } from 'pg';
import {
  asHospital,
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  createTenantDb,
  requireTestDatabaseUrl,
  withTenant,
} from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

const MONEY_TABLES = [
  'opd_visits',
  'bills',
  'bill_lines',
  'payments',
  'receipts',
  'ledger_entries',
  'patient_registration_fees',
] as const;

type Fixture = {
  tenant: string;
  mainBranch: string;
  eastBranch: string;
  user: string;
  doctorProfile: string;
  doctorFee: string;
  regItem: string;
  cash: string;
  upi: string;
  oldMode: string;
  patients: string[];
};

const CONSULTATION_FEE = 50_000;
const REGISTRATION_FEE = 10_000;

describe('OPD visits and money (database rules, hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);

  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  const tenantDb = createTenantDb(app);
  const stamp = Date.now();
  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${stamp}-${(counter += 1)}`;

  let A: Fixture;
  let B: Fixture;

  async function seedHospital(label: string): Promise<Fixture> {
    const hospital = await owner.hospital.create({
      data: {
        code: `VB_${label}_${stamp}`,
        name: `Visits Billing ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `vb-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `vb-${label}-e-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    const tenant = hospital.id;
    const user = await owner.user.create({
      data: {
        tenantId: tenant,
        code: `U${label}${stamp}`,
        email: `vb_${label}_${stamp}@example.test`,
        displayName: 'Person',
        passwordHash: 'x',
      },
    });
    const doctorUser = await owner.user.create({
      data: {
        tenantId: tenant,
        code: `D${label}${stamp}`,
        email: `vb_doc_${label}_${stamp}@example.test`,
        displayName: 'Doctor',
        passwordHash: 'x',
      },
    });
    const mainBranch = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    const eastBranch = hospital.branches.find((b) => b.code === 'EAST')!.id;
    const doctor = await owner.doctorProfile.create({
      data: { tenantId: tenant, userId: doctorUser.id, code: `DOC${label}${stamp}` },
    });
    const fee = await owner.doctorFee.create({
      data: {
        tenantId: tenant,
        doctorProfileId: doctor.id,
        visitType: 'NEW',
        amountPaise: CONSULTATION_FEE,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        createdBy: user.id,
      },
    });
    const regItem = await owner.chargeItem.create({
      data: { tenantId: tenant, code: `REG${label}`, name: 'Registration', kind: 'REGISTRATION' },
    });
    const mode = (code: string, requiresReference: boolean, active = true) =>
      owner.paymentMode.create({
        data: { tenantId: tenant, code, name: code, requiresReference, active },
      });
    const cash = await mode('CASH', false);
    const upi = await mode('UPI', true);
    const oldMode = await mode('OLD', false, false);
    const patients: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const p = await owner.patient.create({
        data: {
          tenantId: tenant,
          uhid: `VB${label}${stamp}${i}`,
          registeredBranchId: mainBranch,
          name: `Patient ${label} ${i}`,
          phone: `+9190000${String(i).padStart(5, '0')}`,
          createdBy: user.id,
        },
      });
      patients.push(p.id);
    }
    return {
      tenant,
      mainBranch,
      eastBranch,
      user: user.id,
      doctorProfile: doctor.id,
      doctorFee: fee.id,
      regItem: regItem.id,
      cash: cash.id,
      upi: upi.id,
      oldMode: oldMode.id,
      patients,
    };
  }

  beforeAll(async () => {
    A = await seedHospital('A');
    B = await seedHospital('B');
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
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
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  async function insertVisit(
    c: Client,
    o: {
      f: Fixture;
      patient: string;
      branch?: string;
      type?: 'NEW' | 'FOLLOW_UP';
      previous?: string | null;
    },
  ): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO opd_visits (id, tenant_id, branch_id, patient_id, doctor_profile_id, visit_type,
                               visit_date, previous_visit_id, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::visit_type, CURRENT_DATE, $7, $8, now())`,
      [
        id,
        o.f.tenant,
        o.branch ?? o.f.mainBranch,
        o.patient,
        o.f.doctorProfile,
        o.type ?? 'NEW',
        o.previous ?? null,
        o.f.user,
      ],
    );
    return id;
  }

  async function insertBill(
    c: Client,
    o: {
      f: Fixture;
      visit: string;
      branch?: string;
      subtotal: number;
      tax?: number;
      total?: number;
      number?: string;
      key?: string;
      type?: 'CONSULTATION' | 'INVESTIGATION';
    },
  ): Promise<string> {
    const id = randomUUID();
    const tax = o.tax ?? 0;
    await c.query(
      `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                          tax_paise, total_paise, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5::bill_type, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        o.f.tenant,
        o.branch ?? o.f.mainBranch,
        o.visit,
        o.type ?? 'CONSULTATION',
        o.number ?? unique('BILL'),
        o.subtotal,
        tax,
        o.total ?? o.subtotal + tax,
        o.key ?? unique('BK'),
        o.f.user,
      ],
    );
    return id;
  }

  async function insertLine(
    c: Client,
    o: {
      f: Fixture;
      bill: string;
      lineNo: number;
      kind: 'CONSULTATION' | 'REGISTRATION' | 'INVESTIGATION';
      unit: number;
      qty?: number;
      tax?: number;
      total?: number;
      source?: 'fee' | 'item' | 'both' | 'none';
    },
  ): Promise<string> {
    const id = randomUUID();
    const qty = o.qty ?? 1;
    const tax = o.tax ?? 0;
    const source = o.source ?? (o.kind === 'CONSULTATION' ? 'fee' : 'item');
    await c.query(
      `INSERT INTO bill_lines (id, tenant_id, bill_id, line_no, kind, charge_item_id, doctor_fee_id,
                               code_snapshot, description_snapshot, quantity, unit_price_paise,
                               tax_rate_bp, tax_paise, line_total_paise)
       VALUES ($1, $2, $3, $4, $5::charge_item_kind, $6, $7, 'C', 'D', $8, $9, 0, $10, $11)`,
      [
        id,
        o.f.tenant,
        o.bill,
        o.lineNo,
        o.kind,
        source === 'item' || source === 'both' ? o.f.regItem : null,
        source === 'fee' || source === 'both' ? o.f.doctorFee : null,
        qty,
        o.unit,
        tax,
        o.total ?? qty * o.unit + tax,
      ],
    );
    return id;
  }

  async function insertRegistrationRecord(
    c: Client,
    f: Fixture,
    patient: string,
    billLine: string,
  ): Promise<void> {
    await c.query(
      `INSERT INTO patient_registration_fees (id, tenant_id, patient_id, bill_line_id)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), f.tenant, patient, billLine],
    );
  }

  /** visit + consultation bill (+ optional registration line and record), all in one transaction. */
  async function newBill(
    c: Client,
    o: {
      f: Fixture;
      patient: string;
      branch?: string;
      fee?: number;
      withRegistration?: boolean;
    },
  ): Promise<{ visit: string; bill: string; total: number }> {
    const fee = o.fee ?? CONSULTATION_FEE;
    const reg = o.withRegistration ? REGISTRATION_FEE : 0;
    const visit = await insertVisit(c, { f: o.f, patient: o.patient, branch: o.branch });
    const bill = await insertBill(c, {
      f: o.f,
      visit,
      branch: o.branch,
      subtotal: fee + reg,
    });
    await insertLine(c, { f: o.f, bill, lineNo: 1, kind: 'CONSULTATION', unit: fee });
    if (o.withRegistration) {
      const line = await insertLine(c, {
        f: o.f,
        bill,
        lineNo: 2,
        kind: 'REGISTRATION',
        unit: REGISTRATION_FEE,
      });
      await insertRegistrationRecord(c, o.f, o.patient, line);
    }
    return { visit, bill, total: fee + reg };
  }

  async function pay(
    c: Client,
    o: {
      f: Fixture;
      bill: string;
      amount: number;
      branch?: string;
      mode?: string;
      reference?: string | null;
      key?: string;
      /** receipt NUMBER for the receipt this call creates */
      receipt?: string;
      /** attach to an existing receipt (split payment) instead of creating one */
      receiptId?: string;
      /** total of the receipt this call creates (default: this payment's amount) */
      receiptTotal?: number;
    },
  ): Promise<string> {
    const branch = o.branch ?? o.f.mainBranch;
    let receiptId = o.receiptId;
    if (!receiptId) {
      receiptId = await newReceipt(c, {
        f: o.f,
        bill: o.bill,
        branch,
        total: o.receiptTotal ?? o.amount,
        number: o.receipt,
      });
    }
    const id = randomUUID();
    await c.query(
      `INSERT INTO payments (id, tenant_id, bill_id, branch_id, receipt_id, payment_mode_id,
                             amount_paise, reference_no, received_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        o.f.tenant,
        o.bill,
        branch,
        receiptId,
        o.mode ?? o.f.cash,
        o.amount,
        o.reference ?? null,
        o.f.user,
        o.key ?? unique('PK'),
      ],
    );
    return id;
  }

  /** A receipt row (the payments of it must be inserted in the same transaction). */
  async function newReceipt(
    c: Client,
    o: { f: Fixture; bill: string; branch?: string; total: number; number?: string },
  ): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO receipts (id, tenant_id, branch_id, bill_id, receipt_number, total_paise,
                             issued_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        o.f.tenant,
        o.branch ?? o.f.mainBranch,
        o.bill,
        o.number ?? unique('RCPT'),
        o.total,
        o.f.user,
        unique('RK'),
      ],
    );
    return id;
  }

  async function billState(f: Fixture, bill: string) {
    return inTenant(f.tenant, async (c) => {
      const r = await c.query<{ paid: number; refunded: number; status: string; total: number }>(
        `SELECT paid_paise AS paid, refunded_paise AS refunded, payment_status AS status,
                total_paise AS total FROM bills WHERE id = $1`,
        [bill],
      );
      return r.rows[0]!;
    });
  }

  async function ledgerOf(f: Fixture, bill: string) {
    return inTenant(f.tenant, async (c) => {
      const r = await c.query<{ entry_type: string; amount_paise: number }>(
        `SELECT entry_type, amount_paise FROM ledger_entries WHERE bill_id = $1 ORDER BY posted_at, id`,
        [bill],
      );
      return r.rows;
    });
  }

  async function queueVisit(c: Client, visit: string, token: number): Promise<void> {
    await c.query(
      `UPDATE opd_visits SET status = 'WAITING', token_date = CURRENT_DATE, token_no = $2,
                             queued_at = now(), updated_at = now() WHERE id = $1`,
      [visit, token],
    );
  }

  /** A visit may become COMPLETED only after its note is COMPLETED (Step 5a-2): write one. */
  async function completeNote(c: Client, visit: string): Promise<void> {
    await c.query(
      `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id, diagnosis)
       SELECT gen_random_uuid()::text, tenant_id, branch_id, id, doctor_profile_id, 'test note'
         FROM opd_visits WHERE id = $1`,
      [visit],
    );
    await c.query(
      `UPDATE consultations SET status = 'COMPLETED', completed_at = now(), updated_at = now()
        WHERE visit_id = $1`,
      [visit],
    );
  }

  let nextPatient = 0;
  const patientFor = (f: Fixture) => {
    nextPatient = (nextPatient + 1) % f.patients.length;
    return f.patients[nextPatient]!;
  };

  // ------------------------------------------------------------------ RLS, grants, isolation

  describe('row level security and grants', () => {
    it('every new table has RLS enabled AND forced', async () => {
      await asOwner(async (c) => {
        const r = await c.query<{ relname: string; on: boolean; forced: boolean }>(
          `SELECT relname, relrowsecurity AS on, relforcerowsecurity AS forced
             FROM pg_class WHERE relname = ANY($1::text[])`,
          [[...MONEY_TABLES]],
        );
        expect(r.rows).toHaveLength(MONEY_TABLES.length);
        for (const row of r.rows) {
          expect({ table: row.relname, on: row.on, forced: row.forced }).toEqual({
            table: row.relname,
            on: true,
            forced: true,
          });
        }
      });
    });

    it('hospigo_hq and hospigo_patient have no privilege at all on these tables', async () => {
      await asOwner(async (c) => {
        for (const role of ['hospigo_hq', 'hospigo_patient']) {
          for (const table of MONEY_TABLES) {
            for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
              const r = await c.query<{ ok: boolean }>(
                `SELECT has_table_privilege($1, $2, $3) AS ok`,
                [role, `public.${table}`, priv],
              );
              expect({ role, table, priv, ok: r.rows[0]!.ok }).toEqual({
                role,
                table,
                priv,
                ok: false,
              });
            }
          }
        }
      });
      const hq = createPgClient('hq');
      await hq.connect();
      try {
        await expect(hq.query('SELECT count(*) FROM bills')).rejects.toThrow(/permission denied/i);
      } finally {
        await hq.end();
      }
    });

    it('the app role: no DELETE anywhere, no UPDATE on money rows, no INSERT on the ledger', async () => {
      await asOwner(async (c) => {
        const has = async (table: string, priv: string) =>
          (
            await c.query<{ ok: boolean }>(
              `SELECT has_table_privilege('hospigo_app', $1, $2) AS ok`,
              [`public.${table}`, priv],
            )
          ).rows[0]!.ok;
        for (const table of MONEY_TABLES) {
          expect({ table, priv: 'DELETE', ok: await has(table, 'DELETE') }).toMatchObject({
            ok: false,
          });
          expect({ table, priv: 'TRUNCATE', ok: await has(table, 'TRUNCATE') }).toMatchObject({
            ok: false,
          });
        }
        for (const table of ['bills', 'bill_lines', 'payments', 'ledger_entries']) {
          expect({ table, ok: await has(table, 'UPDATE') }).toMatchObject({ ok: false });
        }
        expect(await has('ledger_entries', 'INSERT')).toBe(false);
        expect(await has('ledger_entries', 'SELECT')).toBe(true);
        expect(await has('bills', 'INSERT')).toBe(true);
        const col = async (column: string) =>
          (
            await c.query<{ ok: boolean }>(
              `SELECT has_column_privilege('hospigo_app', 'public.opd_visits', $1, 'UPDATE') AS ok`,
              [column],
            )
          ).rows[0]!.ok;
        for (const column of ['status', 'token_no', 'queued_at', 'consultation_started_at']) {
          expect({ column, ok: await col(column) }).toMatchObject({ ok: true });
        }
        for (const column of [
          'tenant_id',
          'branch_id',
          'patient_id',
          'doctor_profile_id',
          'visit_type',
          'visit_date',
          'previous_visit_id',
          'created_by',
        ]) {
          expect({ column, ok: await col(column) }).toMatchObject({ ok: false });
        }
      });
    });

    it('another hospital sees none of the rows and cannot write rows of this hospital', async () => {
      const made = await inTenant(A.tenant, async (c) => {
        const b = await newBill(c, { f: A, patient: patientFor(A), withRegistration: true });
        await pay(c, { f: A, bill: b.bill, amount: b.total });
        return b;
      });

      // Reads: every table returns nothing under hospital B, and nothing with no tenant set.
      for (const tenant of [B.tenant, '']) {
        await inTenant(tenant, async (c) => {
          const counts: Record<string, number> = {};
          for (const table of MONEY_TABLES) {
            const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
            counts[table] = Number(r.rows[0]!.n);
          }
          const ownRows = counts['opd_visits'];
          // Hospital B has no visits of its own yet in this test.
          expect(ownRows).toBe(0);
          for (const table of MONEY_TABLES) {
            expect({ tenant: tenant || 'none', table, n: counts[table] }).toMatchObject({ n: 0 });
          }
        });
      }

      // Writes with hospital A's tenant_id while the session belongs to B are refused.
      await expect(
        inTenant(B.tenant, (c) =>
          insertVisit(c, { f: A, patient: A.patients[0]!, branch: A.mainBranch }),
        ),
      ).rejects.toThrow(/row-level security|violates/i);

      // A payment on A's bill from B's session: refused, with the same error as "no such bill".
      const attackA = await inTenant(B.tenant, (c) =>
        pay(c, { f: A, bill: made.bill, amount: 100 }),
      ).catch((e: Error) => e.message);
      expect(String(attackA)).toMatch(/tenant mismatch/i);
      const attackB = await inTenant(B.tenant, (c) =>
        pay(c, { f: B, bill: made.bill, amount: 100 }),
      ).catch((e: Error) => e.message);
      expect(String(attackB)).toMatch(/bill not found/i);
      const unknown = await inTenant(B.tenant, (c) =>
        pay(c, { f: B, bill: randomUUID(), amount: 100 }),
      ).catch((e: Error) => e.message);
      expect(String(unknown)).toBe(String(attackB));
    });
  });

  // ------------------------------------------------------------------------- append-only

  describe('append-only and delete protection', () => {
    let ids: { visit: string; bill: string; payment: string; line: string; ledger: string };

    beforeAll(async () => {
      ids = await inTenant(A.tenant, async (c) => {
        const b = await newBill(c, { f: A, patient: patientFor(A) });
        const payment = await pay(c, { f: A, bill: b.bill, amount: b.total });
        const line = (
          await c.query<{ id: string }>(`SELECT id FROM bill_lines WHERE bill_id=$1`, [b.bill])
        ).rows[0]!.id;
        const ledger = (
          await c.query<{ id: string }>(`SELECT id FROM ledger_entries WHERE bill_id=$1 LIMIT 1`, [
            b.bill,
          ])
        ).rows[0]!.id;
        return { visit: b.visit, bill: b.bill, payment, line, ledger };
      });
    });

    it('UPDATE and DELETE on bill_lines, payments and ledger_entries are refused, even for the owner', async () => {
      await asOwner(async (c) => {
        const cases: Array<[string, string]> = [
          ['bill_lines', ids.line],
          ['payments', ids.payment],
          ['ledger_entries', ids.ledger],
        ];
        for (const [table, id] of cases) {
          await expect(
            c.query(`UPDATE ${table} SET tenant_id = tenant_id WHERE id = $1`, [id]),
          ).rejects.toThrow(/append-only/i);
          await expect(c.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(
            /append-only/i,
          );
        }
      });
    });

    it('bills, visits and registration records can never be deleted; nothing can be truncated', async () => {
      await asOwner(async (c) => {
        await expect(c.query(`DELETE FROM bills WHERE id = $1`, [ids.bill])).rejects.toThrow(
          /append-only/i,
        );
        await expect(c.query(`DELETE FROM opd_visits WHERE id = $1`, [ids.visit])).rejects.toThrow(
          /append-only/i,
        );
        await expect(c.query(`DELETE FROM patient_registration_fees`)).rejects.toThrow(
          /append-only/i,
        );
        for (const table of MONEY_TABLES) {
          await expect(c.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(
            /append-only|truncate/i,
          );
        }
      });
    });

    it('the app role cannot UPDATE a bill and cannot INSERT into the ledger', async () => {
      await inTenant(A.tenant, async (c) => {
        await c.query('SAVEPOINT s1');
        await expect(
          c.query(`UPDATE bills SET paid_paise = 0 WHERE id = $1`, [ids.bill]),
        ).rejects.toThrow(/permission denied/i);
        await c.query('ROLLBACK TO SAVEPOINT s1');
        await expect(
          c.query(
            `INSERT INTO ledger_entries (id, tenant_id, bill_id, branch_id, entry_type, amount_paise)
             VALUES ($1, $2, $3, $4, 'CHARGE', 1)`,
            [randomUUID(), A.tenant, ids.bill, A.mainBranch],
          ),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it('even the owner cannot change a bill amount, or its paid columns outside the ledger trigger', async () => {
      await asOwner(async (c) => {
        await expect(
          c.query(`UPDATE bills SET total_paise = total_paise + 1 WHERE id = $1`, [ids.bill]),
        ).rejects.toThrow(/immutable|check/i);
        await expect(
          c.query(`UPDATE bills SET bill_number = 'x' WHERE id = $1`, [ids.bill]),
        ).rejects.toThrow(/immutable/i);
        await expect(
          c.query(`UPDATE bills SET paid_paise = 0, payment_status = 'UNPAID' WHERE id = $1`, [
            ids.bill,
          ]),
        ).rejects.toThrow(/maintained by the ledger/i);
        // Even setting the trigger flag by hand does not let the app role forge it (no UPDATE privilege).
      });
    });
  });

  // ------------------------------------------------------------------------- bills and payments

  describe('bills, lines and the ledger', () => {
    it('ignores what the caller sends for paid / refunded / status (a bill is born unpaid)', async () => {
      const made = await inTenant(A.tenant, async (c) => {
        const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
        const id = randomUUID();
        await c.query(
          `INSERT INTO bills (id, tenant_id, branch_id, visit_id, bill_type, bill_number, subtotal_paise,
                              tax_paise, total_paise, paid_paise, refunded_paise, payment_status,
                              idempotency_key, created_by)
           VALUES ($1, $2, $3, $4, 'CONSULTATION', $5, 50000, 0, 50000, 50000, 10, 'PAID', $6, $7)`,
          [id, A.tenant, A.mainBranch, visit, unique('BILL'), unique('BK'), A.user],
        );
        await insertLine(c, { f: A, bill: id, lineNo: 1, kind: 'CONSULTATION', unit: 50_000 });
        return id;
      });
      expect(await billState(A, made)).toEqual({
        paid: 0,
        refunded: 0,
        status: 'UNPAID',
        total: 50_000,
      });
      expect(await ledgerOf(A, made)).toEqual([{ entry_type: 'CHARGE', amount_paise: 50_000 }]);
    });

    it('a zero-total bill (free follow-up) is settled at once and moves no money', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 0 }),
      );
      expect(await billState(A, made.bill)).toEqual({
        paid: 0,
        refunded: 0,
        status: 'PAID',
        total: 0,
      });
      expect(await ledgerOf(A, made.bill)).toEqual([]);
      // Nothing is left to pay.
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 1 })),
      ).rejects.toThrow(/exceeds/i);
    });

    it('a full payment writes the ledger and the database marks the bill PAID', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), withRegistration: true }),
      );
      expect(made.total).toBe(CONSULTATION_FEE + REGISTRATION_FEE);
      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: made.total }));
      expect(await billState(A, made.bill)).toEqual({
        paid: made.total,
        refunded: 0,
        status: 'PAID',
        total: made.total,
      });
      expect(await ledgerOf(A, made.bill)).toEqual([
        { entry_type: 'CHARGE', amount_paise: made.total },
        { entry_type: 'PAYMENT', amount_paise: made.total },
      ]);
    });

    it('part payments add up (PART_PAID then PAID) and the balance can never be exceeded', async () => {
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 20_000 }));
      expect(await billState(A, made.bill)).toMatchObject({ paid: 20_000, status: 'PART_PAID' });
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 30_001 })),
      ).rejects.toThrow(/exceeds/i);
      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 30_000 }));
      expect(await billState(A, made.bill)).toMatchObject({ paid: 50_000, status: 'PAID' });
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 1 })),
      ).rejects.toThrow(/exceeds/i);
      const sum = (await ledgerOf(A, made.bill))
        .filter((r) => r.entry_type === 'PAYMENT')
        .reduce((s, r) => s + r.amount_paise, 0);
      expect(sum).toBe(50_000);
    });

    it('refuses zero, negative and fractional-by-design amounts and bad modes', async () => {
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      for (const amount of [0, -5]) {
        await expect(
          inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount })),
        ).rejects.toThrow(/check|positive|violates/i);
      }
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 100, mode: A.oldMode })),
      ).rejects.toThrow(/not available/i);
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 100, mode: B.cash })),
      ).rejects.toThrow();
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 100, mode: A.upi })),
      ).rejects.toThrow(/reference number/i);
      await expect(
        inTenant(A.tenant, (c) =>
          pay(c, { f: A, bill: made.bill, amount: 100, mode: A.upi, reference: '   ' }),
        ),
      ).rejects.toThrow(/reference number/i);
      await inTenant(A.tenant, (c) =>
        pay(c, { f: A, bill: made.bill, amount: 100, mode: A.upi, reference: 'UTR123' }),
      );
      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 100, mode: A.cash }));
      expect((await billState(A, made.bill)).paid).toBe(200);
    });

    it('a bill must equal its lines at commit (sum, tax, subtotal, at least one line)', async () => {
      const bad = async (build: (c: Client) => Promise<void>) =>
        expect(inTenant(A.tenant, build)).rejects.toThrow(/sum of its lines|check|violates/i);

      // Lines worth less than the bill.
      await bad(async (c) => {
        const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
        const bill = await insertBill(c, { f: A, visit, subtotal: 50_000 });
        await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 40_000 });
      });
      // No lines at all.
      await bad(async (c) => {
        const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
        await insertBill(c, { f: A, visit, subtotal: 50_000 });
      });
      // Tax on the bill that the lines do not carry.
      await bad(async (c) => {
        const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
        const bill = await insertBill(c, { f: A, visit, subtotal: 50_000, tax: 500 });
        await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 50_000 });
      });
      // total <> subtotal + tax
      await bad(async (c) => {
        const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
        const bill = await insertBill(c, { f: A, visit, subtotal: 50_000, total: 50_001 });
        await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 50_000 });
      });
      // Tax-bearing lines that DO add up are fine.
      const ok = await inTenant(A.tenant, async (c) => {
        const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
        const bill = await insertBill(c, { f: A, visit, subtotal: 50_000, tax: 2_500 });
        await insertLine(c, {
          f: A,
          bill,
          lineNo: 1,
          kind: 'CONSULTATION',
          unit: 50_000,
          tax: 2_500,
        });
        return bill;
      });
      expect(await billState(A, ok)).toMatchObject({ total: 52_500, status: 'UNPAID' });
    });

    it('a line cannot be added to an existing bill later', async () => {
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await expect(
        inTenant(A.tenant, (c) =>
          insertLine(c, { f: A, bill: made.bill, lineNo: 2, kind: 'INVESTIGATION', unit: 100 }),
        ),
      ).rejects.toThrow(/sum of its lines/i);
    });

    it('line arithmetic and price source are enforced', async () => {
      const lineCase = (o: Partial<Parameters<typeof insertLine>[1]>) =>
        expect(
          inTenant(A.tenant, async (c) => {
            const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
            const bill = await insertBill(c, { f: A, visit, subtotal: 50_000 });
            await insertLine(c, {
              f: A,
              bill,
              lineNo: 1,
              kind: 'CONSULTATION',
              unit: 50_000,
              ...o,
            });
          }),
        ).rejects.toThrow(/check|violates/i);
      await lineCase({ total: 49_999 });
      await lineCase({ qty: 0 });
      await lineCase({ source: 'both' });
      await lineCase({ source: 'none' });
    });

    it('bill numbers, idempotency keys, receipts and one consultation bill per visit are unique', async () => {
      const first = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      const dup = async (o: { number?: string; key?: string }) =>
        expect(
          inTenant(A.tenant, async (c) => {
            const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
            const bill = await insertBill(c, { f: A, visit, subtotal: 100, ...o });
            await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 100 });
          }),
        ).rejects.toThrow(/duplicate|unique/i);
      const existing = await inTenant(A.tenant, (c) =>
        c.query<{ bill_number: string; idempotency_key: string }>(
          `SELECT bill_number, idempotency_key FROM bills WHERE id = $1`,
          [first.bill],
        ),
      );
      await dup({ number: existing.rows[0]!.bill_number });
      await dup({ key: existing.rows[0]!.idempotency_key });
      // Second consultation bill for the same visit.
      await expect(
        inTenant(A.tenant, async (c) => {
          const bill = await insertBill(c, { f: A, visit: first.visit, subtotal: 100 });
          await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 100 });
        }),
      ).rejects.toThrow(/duplicate|unique|awaiting payment/i);
      // Receipt number and payment key.
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await inTenant(A.tenant, (c) =>
        pay(c, { f: A, bill: made.bill, amount: 100, receipt: 'R-DUP', key: 'K-DUP' }),
      );
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 100, receipt: 'R-DUP' })),
      ).rejects.toThrow(/duplicate|unique/i);
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 100, key: 'K-DUP' })),
      ).rejects.toThrow(/duplicate|unique/i);
      expect((await billState(A, made.bill)).paid).toBe(100);
    });

    it('the bill branch must be the visit branch, and a payment must use the bill branch', async () => {
      await expect(
        inTenant(A.tenant, async (c) => {
          const visit = await insertVisit(c, {
            f: A,
            patient: patientFor(A),
            branch: A.mainBranch,
          });
          const bill = await insertBill(c, { f: A, visit, branch: A.eastBranch, subtotal: 100 });
          await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 100 });
        }),
      ).rejects.toThrow(/foreign key|violates/i);
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await expect(
        inTenant(A.tenant, (c) =>
          pay(c, { f: A, bill: made.bill, amount: 100, branch: A.eastBranch }),
        ),
      ).rejects.toThrow(/branch|foreign key|violates/i);
    });

    it('a consultation bill needs a visit awaiting payment, and a cancelled visit takes no payment', async () => {
      const paid = await inTenant(A.tenant, async (c) => {
        const m = await newBill(c, { f: A, patient: patientFor(A) });
        await pay(c, { f: A, bill: m.bill, amount: m.total });
        await queueVisit(c, m.visit, 1);
        return m;
      });
      await expect(
        inTenant(A.tenant, async (c) => {
          const bill = await insertBill(c, { f: A, visit: paid.visit, subtotal: 100 });
          await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 100 });
        }),
      ).rejects.toThrow(/awaiting payment|duplicate|unique/i);

      const cancelled = await inTenant(A.tenant, async (c) => {
        const m = await newBill(c, { f: A, patient: patientFor(A) });
        await c.query(
          `UPDATE opd_visits SET status = 'CANCELLED', cancelled_at = now(),
                                 cancelled_reason = 'left', updated_at = now() WHERE id = $1`,
          [m.visit],
        );
        return m;
      });
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: cancelled.bill, amount: 100 })),
      ).rejects.toThrow(/cancelled/i);
    });

    it('PARALLEL payments can never exceed the bill (row lock): 12 payers, room for 4', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 20_000 }),
      );
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 5_000 })),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(4);
      expect(failed).toHaveLength(8);
      for (const f of failed) {
        expect(String(f.reason)).toMatch(/exceeds/i);
      }
      expect(await billState(A, made.bill)).toEqual({
        paid: 20_000,
        refunded: 0,
        status: 'PAID',
        total: 20_000,
      });
      const ledgerSum = (await ledgerOf(A, made.bill))
        .filter((r) => r.entry_type === 'PAYMENT')
        .reduce((s, r) => s + r.amount_paise, 0);
      expect(ledgerSum).toBe(20_000);
    });

    it('PARALLEL double submit with the same idempotency key charges once', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 10_000 }),
      );
      const key = unique('SAMEKEY');
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          inTenant(A.tenant, (c) =>
            pay(c, { f: A, bill: made.bill, amount: 10_000, key, receipt: `${key}-${i}` }),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await billState(A, made.bill)).toMatchObject({ paid: 10_000, status: 'PAID' });
    });
  });

  // ------------------------------------------------------------- split payment, one receipt

  describe('split payment: one receipt covers several payments (Step 5a-1)', () => {
    const receiptRows = (f: Fixture, bill: string) =>
      asOwner(
        async (c) =>
          (
            await c.query<{ id: string; receipt_number: string; total_paise: number }>(
              `SELECT id, receipt_number, total_paise FROM receipts WHERE tenant_id = $1 AND bill_id = $2`,
              [f.tenant, bill],
            )
          ).rows,
      );
    const paymentRows = (f: Fixture, bill: string) =>
      asOwner(
        async (c) =>
          (
            await c.query<{ receipt_id: string; amount_paise: number }>(
              `SELECT receipt_id, amount_paise FROM payments WHERE tenant_id = $1 AND bill_id = $2 ORDER BY amount_paise`,
              [f.tenant, bill],
            )
          ).rows,
      );

    it('UPI 300 + cash 200 on a bill of 500 = ONE receipt, two payments, two ledger entries, bill PAID', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 50_000 }),
      );
      await inTenant(A.tenant, async (c) => {
        const receipt = await newReceipt(c, { f: A, bill: made.bill, total: 50_000 });
        await pay(c, {
          f: A,
          bill: made.bill,
          amount: 30_000,
          mode: A.upi,
          reference: 'UTR-1',
          receiptId: receipt,
        });
        await pay(c, { f: A, bill: made.bill, amount: 20_000, receiptId: receipt });
      });
      const receipts = await receiptRows(A, made.bill);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.total_paise).toBe(50_000);
      const payments = await paymentRows(A, made.bill);
      expect(payments.map((p) => p.amount_paise)).toEqual([20_000, 30_000]);
      expect(new Set(payments.map((p) => p.receipt_id))).toEqual(new Set([receipts[0]!.id]));
      expect(await billState(A, made.bill)).toEqual({
        paid: 50_000,
        refunded: 0,
        status: 'PAID',
        total: 50_000,
      });
      const ledger = (await ledgerOf(A, made.bill)).filter((r) => r.entry_type === 'PAYMENT');
      expect(ledger.map((r) => r.amount_paise).sort((a, b) => a - b)).toEqual([20_000, 30_000]);
    });

    it('a receipt must equal the sum of its payments at commit (too small, too big, or no payment at all)', async () => {
      const make = () =>
        inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A), fee: 50_000 }));
      // receipt says 500 but the payments are only 300
      const a = await make();
      await expect(
        inTenant(A.tenant, async (c) => {
          const r = await newReceipt(c, { f: A, bill: a.bill, total: 50_000 });
          await pay(c, { f: A, bill: a.bill, amount: 30_000, receiptId: r });
        }),
      ).rejects.toThrow(/sum of its payments/i);
      // receipt says 300 but the payments add up to 500
      const b = await make();
      await expect(
        inTenant(A.tenant, async (c) => {
          const r = await newReceipt(c, { f: A, bill: b.bill, total: 30_000 });
          await pay(c, {
            f: A,
            bill: b.bill,
            amount: 30_000,
            mode: A.upi,
            reference: 'U',
            receiptId: r,
          });
          await pay(c, { f: A, bill: b.bill, amount: 20_000, receiptId: r });
        }),
      ).rejects.toThrow(/sum of its payments/i);
      // a receipt with no payment
      const d = await make();
      await expect(
        inTenant(A.tenant, (c) => newReceipt(c, { f: A, bill: d.bill, total: 50_000 })),
      ).rejects.toThrow(/sum of its payments/i);
      for (const m of [a, b, d]) {
        expect(await receiptRows(A, m.bill)).toHaveLength(0);
        expect(await paymentRows(A, m.bill)).toHaveLength(0);
        expect(await billState(A, m.bill)).toMatchObject({ paid: 0, status: 'UNPAID' });
      }
    });

    it('one payment mode at most once per receipt; a payment on a receipt of ANOTHER bill is refused', async () => {
      const x = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 50_000 }),
      );
      await expect(
        inTenant(A.tenant, async (c) => {
          const r = await newReceipt(c, { f: A, bill: x.bill, total: 50_000 });
          await pay(c, { f: A, bill: x.bill, amount: 30_000, receiptId: r });
          await pay(c, { f: A, bill: x.bill, amount: 20_000, receiptId: r });
        }),
      ).rejects.toThrow(/payments_receipt_mode_key|duplicate key/i);
      const y = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 50_000 }),
      );
      const z = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 50_000 }),
      );
      await expect(
        inTenant(A.tenant, async (c) => {
          const r = await newReceipt(c, { f: A, bill: y.bill, total: 50_000 });
          await pay(c, { f: A, bill: z.bill, amount: 50_000, receiptId: r });
        }),
      ).rejects.toThrow(/payments_receipt_fkey|foreign key/i);
    });

    it('a payment can NOT be added to a receipt that was already issued (a later payment needs its own receipt)', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 100_000 }),
      );
      // Receipt of 500 on a bill of 1000: room is left on the bill.
      const receipt = await inTenant(A.tenant, async (c) => {
        const r = await newReceipt(c, { f: A, bill: made.bill, total: 50_000 });
        await pay(c, { f: A, bill: made.bill, amount: 50_000, receiptId: r });
        return r;
      });
      // A second transaction tries to slip another payment onto the same receipt.
      await expect(
        inTenant(A.tenant, (c) =>
          pay(c, {
            f: A,
            bill: made.bill,
            amount: 30_000,
            mode: A.upi,
            reference: 'LATE',
            receiptId: receipt,
          }),
        ),
      ).rejects.toThrow(/sum of its payments/i);
      expect(await billState(A, made.bill)).toMatchObject({ paid: 50_000, status: 'PART_PAID' });
      // The rest of the bill is paid with a NEW receipt.
      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 50_000 }));
      expect(await receiptRows(A, made.bill)).toHaveLength(2);
      expect(await billState(A, made.bill)).toMatchObject({ paid: 100_000, status: 'PAID' });
    });

    it('a receipt in another branch than its bill is refused', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 10_000 }),
      );
      await expect(
        inTenant(A.tenant, (c) =>
          newReceipt(c, { f: A, bill: made.bill, branch: A.eastBranch, total: 10_000 }),
        ),
      ).rejects.toThrow(/receipts_bill_fkey|foreign key/i);
    });

    it('receipts are append-only, even for the owner; the app role cannot change or delete them', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 10_000 }),
      );
      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 10_000 }));
      const [receipt] = await receiptRows(A, made.bill);
      await asOwner(async (c) => {
        await expect(
          c.query(`UPDATE receipts SET total_paise = 1 WHERE id = $1`, [receipt!.id]),
        ).rejects.toThrow(/append-only/i);
        await expect(c.query(`DELETE FROM receipts WHERE id = $1`, [receipt!.id])).rejects.toThrow(
          /append-only/i,
        );
        await expect(c.query(`TRUNCATE receipts`)).rejects.toThrow(/append-only|truncate/i);
      });
      await inTenant(A.tenant, async (c) => {
        await expect(
          c.query(`UPDATE receipts SET total_paise = 1 WHERE id = $1`, [receipt!.id]),
        ).rejects.toThrow(/permission denied|append-only/i);
      });
    });

    it('the receipt number is unique per hospital; another hospital may use the same number', async () => {
      const m1 = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 10_000 }),
      );
      const m2 = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 10_000 }),
      );
      const number = unique('RN');
      await inTenant(A.tenant, (c) =>
        pay(c, { f: A, bill: m1.bill, amount: 10_000, receipt: number }),
      );
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: m2.bill, amount: 10_000, receipt: number })),
      ).rejects.toThrow(/receipts_tenant_id_receipt_number_key|duplicate key/i);
      const other = await inTenant(B.tenant, (c) =>
        newBill(c, { f: B, patient: patientFor(B), fee: 10_000 }),
      );
      await inTenant(B.tenant, (c) =>
        pay(c, { f: B, bill: other.bill, amount: 10_000, receipt: number }),
      );
    });

    it('another hospital cannot add a receipt to this hospital\'s bill (same "bill not found" as an unknown bill)', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 10_000 }),
      );
      const own = await inTenant(B.tenant, (c) =>
        newReceipt(c, { f: B, bill: made.bill, total: 10_000 }),
      ).catch((e: Error) => e.message);
      const unknown = await inTenant(B.tenant, (c) =>
        newReceipt(c, { f: B, bill: randomUUID(), total: 10_000 }),
      ).catch((e: Error) => e.message);
      expect(String(own)).toMatch(/bill not found/i);
      expect(String(own)).toBe(String(unknown));
      const forged = await inTenant(B.tenant, (c) =>
        newReceipt(c, { f: A, bill: made.bill, total: 10_000 }),
      ).catch((e: Error) => e.message);
      expect(String(forged)).toMatch(/tenant mismatch/i);
    });

    it('PARALLEL split receipts on one bill: exactly one wins, no deadlock, no overpayment', async () => {
      const made = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 50_000 }),
      );
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          inTenant(A.tenant, async (c) => {
            const r = await newReceipt(c, { f: A, bill: made.bill, total: 50_000 });
            await pay(c, {
              f: A,
              bill: made.bill,
              amount: 30_000,
              mode: A.upi,
              reference: 'U',
              receiptId: r,
            });
            await pay(c, { f: A, bill: made.bill, amount: 20_000, receiptId: r });
          }),
        ),
      );
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const f of failed) {
        expect(String(f.reason)).toMatch(/exceeds/i);
        expect(String(f.reason)).not.toMatch(/deadlock/i);
      }
      expect(await receiptRows(A, made.bill)).toHaveLength(1);
      expect(await billState(A, made.bill)).toMatchObject({ paid: 50_000, status: 'PAID' });
    });
  });

  // ---------------------------------------------------------------------------------- visits

  describe('visits, queue gate and tokens', () => {
    it('a visit must start awaiting payment (no direct WAITING visit, no token, no queue time)', async () => {
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(
            `INSERT INTO opd_visits (id, tenant_id, branch_id, patient_id, doctor_profile_id, visit_type,
                                     visit_date, status, token_date, token_no, queued_at, created_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'NEW', CURRENT_DATE, 'WAITING', CURRENT_DATE, 1, now(), $6, now())`,
            [randomUUID(), A.tenant, A.mainBranch, A.patients[0], A.doctorProfile, A.user],
          ),
        ),
      ).rejects.toThrow(/AWAITING_PAYMENT/);
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(
            `INSERT INTO opd_visits (id, tenant_id, branch_id, patient_id, doctor_profile_id, visit_type,
                                     visit_date, token_date, token_no, created_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'NEW', CURRENT_DATE, CURRENT_DATE, 1, $6, now())`,
            [randomUUID(), A.tenant, A.mainBranch, A.patients[0], A.doctorProfile, A.user],
          ),
        ),
      ).rejects.toThrow(/check|violates/i);
    });

    it('QUEUE GATE: an unpaid or part-paid visit cannot wait; a paid or zero-total one can', async () => {
      const unpaid = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await expect(inTenant(A.tenant, (c) => queueVisit(c, unpaid.visit, 901))).rejects.toThrow(
        /before its consultation bill is paid/i,
      );

      await inTenant(A.tenant, (c) => pay(c, { f: A, bill: unpaid.bill, amount: 100 }));
      await expect(inTenant(A.tenant, (c) => queueVisit(c, unpaid.visit, 901))).rejects.toThrow(
        /before its consultation bill is paid/i,
      );

      await inTenant(A.tenant, (c) =>
        pay(c, { f: A, bill: unpaid.bill, amount: unpaid.total - 100 }),
      );
      await inTenant(A.tenant, (c) => queueVisit(c, unpaid.visit, 901));

      const free = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), fee: 0 }),
      );
      await inTenant(A.tenant, (c) => queueVisit(c, free.visit, 902));
      const states = await inTenant(A.tenant, (c) =>
        c.query<{ status: string }>(`SELECT status FROM opd_visits WHERE id = ANY($1::text[])`, [
          [unpaid.visit, free.visit],
        ]),
      );
      expect(states.rows.map((r) => r.status)).toEqual(['WAITING', 'WAITING']);
    });

    it('a token is unique per branch per day (other branch or day is fine)', async () => {
      const mk = async (branch: string, token: number, date?: string) => {
        const m = await inTenant(A.tenant, async (c) => {
          const made = await newBill(c, { f: A, patient: patientFor(A), branch });
          await pay(c, { f: A, bill: made.bill, amount: made.total, branch });
          return made;
        });
        return inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE opd_visits SET status = 'WAITING', token_date = COALESCE($3::date, CURRENT_DATE),
                                   token_no = $2, queued_at = now(), updated_at = now() WHERE id = $1`,
            [m.visit, token, date ?? null],
          ),
        );
      };
      await mk(A.mainBranch, 701);
      await expect(mk(A.mainBranch, 701)).rejects.toThrow(/duplicate|unique/i);
      await mk(A.eastBranch, 701);
      await mk(A.mainBranch, 701, '2000-01-01');
      await expect(mk(A.mainBranch, 0)).rejects.toThrow(/check|violates/i);
    });

    it('status moves only forward, terminal visits are frozen, identity columns are fixed', async () => {
      const m = await inTenant(A.tenant, async (c) => {
        const made = await newBill(c, { f: A, patient: patientFor(A) });
        await pay(c, { f: A, bill: made.bill, amount: made.total });
        await queueVisit(c, made.visit, 801);
        return made;
      });
      const upd = (sql: string) =>
        inTenant(A.tenant, (c) => c.query(sql.replace(/\$V/g, `'${m.visit}'`)));
      // WAITING cannot jump to COMPLETED; IN_CONSULTATION needs a start time.
      await expect(
        upd(
          `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), consultation_started_at=now(), updated_at=now() WHERE id=$V`,
        ),
      ).rejects.toThrow(/cannot go from/i);
      await expect(
        upd(`UPDATE opd_visits SET status='IN_CONSULTATION', updated_at=now() WHERE id=$V`),
      ).rejects.toThrow(/check|violates/i);
      await upd(
        `UPDATE opd_visits SET status='IN_CONSULTATION', consultation_started_at=now(), updated_at=now() WHERE id=$V`,
      );
      // Write-once columns.
      await expect(
        upd(`UPDATE opd_visits SET token_no=802, updated_at=now() WHERE id=$V`),
      ).rejects.toThrow(/token of a visit cannot change/i);
      await expect(
        upd(
          `UPDATE opd_visits SET queued_at=now() + interval '1 hour', updated_at=now() WHERE id=$V`,
        ),
      ).rejects.toThrow(/queued_at cannot change/i);
      await expect(
        upd(`UPDATE opd_visits SET consultation_started_at=NULL, updated_at=now() WHERE id=$V`),
      ).rejects.toThrow();
      await expect(
        upd(`UPDATE opd_visits SET status='WAITING', updated_at=now() WHERE id=$V`),
      ).rejects.toThrow(/cannot go from/i);
      // Cancel needs a reason; completion needs completed_at and a completed note.
      await inTenant(A.tenant, (c) => completeNote(c, m.visit));
      await expect(
        upd(`UPDATE opd_visits SET status='COMPLETED', updated_at=now() WHERE id=$V`),
      ).rejects.toThrow(/check|violates/i);
      await upd(
        `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$V`,
      );
      // Terminal: no further change at all.
      await expect(upd(`UPDATE opd_visits SET updated_at=now() WHERE id=$V`)).rejects.toThrow(
        /cannot be changed/i,
      );
      await expect(
        upd(
          `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='x', updated_at=now() WHERE id=$V`,
        ),
      ).rejects.toThrow(/cannot be changed/i);
      // Identity columns: the app role has no privilege; the owner is stopped by the trigger.
      await expect(upd(`UPDATE opd_visits SET patient_id='x' WHERE id=$V`)).rejects.toThrow(
        /permission denied/i,
      );
      await asOwner(async (c) => {
        await expect(
          c.query(
            `UPDATE opd_visits SET doctor_profile_id = doctor_profile_id || 'x' WHERE id = $1`,
            [m.visit],
          ),
        ).rejects.toThrow(/immutable|foreign key|cannot be changed/i);
      });
    });

    it('cancelling needs a reason and a time', async () => {
      const m = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), updated_at=now() WHERE id=$1`,
            [m.visit],
          ),
        ),
      ).rejects.toThrow(/check|violates/i);
      await inTenant(A.tenant, (c) =>
        c.query(
          `UPDATE opd_visits SET status='CANCELLED', cancelled_at=now(), cancelled_reason='left', updated_at=now() WHERE id=$1`,
          [m.visit],
        ),
      );
    });

    it('a follow-up links only to a COMPLETED visit of the SAME patient', async () => {
      const patient = patientFor(A);
      const other = patientFor(A);
      const done = await inTenant(A.tenant, async (c) => {
        const made = await newBill(c, { f: A, patient });
        await pay(c, { f: A, bill: made.bill, amount: made.total });
        await queueVisit(c, made.visit, 851);
        await c.query(
          `UPDATE opd_visits SET status='IN_CONSULTATION', consultation_started_at=now(), updated_at=now() WHERE id=$1`,
          [made.visit],
        );
        await completeNote(c, made.visit);
        await c.query(
          `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
          [made.visit],
        );
        return made.visit;
      });
      await inTenant(A.tenant, (c) =>
        insertVisit(c, { f: A, patient, type: 'FOLLOW_UP', previous: done }),
      );
      await expect(
        inTenant(A.tenant, (c) =>
          insertVisit(c, { f: A, patient: other, type: 'FOLLOW_UP', previous: done }),
        ),
      ).rejects.toThrow(/same patient/i);
      await expect(
        inTenant(A.tenant, (c) => insertVisit(c, { f: A, patient, type: 'NEW', previous: done })),
      ).rejects.toThrow(/check|violates/i);
      const open = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient }));
      await expect(
        inTenant(A.tenant, (c) =>
          insertVisit(c, { f: A, patient, type: 'FOLLOW_UP', previous: open.visit }),
        ),
      ).rejects.toThrow(/completed visit/i);
    });
  });

  // ----------------------------------------------------------------- registration fee (once)

  describe('registration fee once per patient, across branches', () => {
    it('is charged once; a second charge at another branch fails at commit', async () => {
      const patient = patientFor(A);
      await inTenant(A.tenant, (c) => newBill(c, { f: A, patient, withRegistration: true }));
      await expect(
        inTenant(A.tenant, (c) =>
          newBill(c, { f: A, patient, branch: A.eastBranch, withRegistration: true }),
        ),
      ).rejects.toThrow(/duplicate|unique/i);
      // Without the registration line the same patient can be billed normally at the other branch.
      await inTenant(A.tenant, (c) => newBill(c, { f: A, patient, branch: A.eastBranch }));
    });

    it('a registration line without its record is refused (no way around the once-only rule)', async () => {
      await expect(
        inTenant(A.tenant, async (c) => {
          const visit = await insertVisit(c, { f: A, patient: patientFor(A) });
          const bill = await insertBill(c, { f: A, visit, subtotal: 60_000 });
          await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 50_000 });
          await insertLine(c, { f: A, bill, lineNo: 2, kind: 'REGISTRATION', unit: 10_000 });
        }),
      ).rejects.toThrow(/registration_fees record/i);
    });

    it('the record must point at a REGISTRATION line of a bill of the same patient', async () => {
      const p1 = patientFor(A);
      const p2 = patientFor(A);
      await expect(
        inTenant(A.tenant, async (c) => {
          const m = await newBill(c, { f: A, patient: p1 });
          const line = (
            await c.query<{ id: string }>(`SELECT id FROM bill_lines WHERE bill_id = $1`, [m.bill])
          ).rows[0]!.id;
          await insertRegistrationRecord(c, A, p1, line);
        }),
      ).rejects.toThrow(/REGISTRATION line/i);
      await expect(
        inTenant(A.tenant, async (c) => {
          const visit = await insertVisit(c, { f: A, patient: p1 });
          const bill = await insertBill(c, { f: A, visit, subtotal: 10_000 });
          const line = await insertLine(c, {
            f: A,
            bill,
            lineNo: 1,
            kind: 'REGISTRATION',
            unit: 10_000,
          });
          await insertRegistrationRecord(c, A, p2, line);
        }),
      ).rejects.toThrow(/same patient/i);
    });

    it('once a later step voids the record (owner), the patient can be charged again', async () => {
      const patient = patientFor(A);
      await inTenant(A.tenant, (c) => newBill(c, { f: A, patient, withRegistration: true }));
      await asOwner((c) =>
        c.query(`UPDATE patient_registration_fees SET voided_at = now() WHERE patient_id = $1`, [
          patient,
        ]),
      );
      await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient, branch: A.eastBranch, withRegistration: true }),
      );
    });
  });

  // ------------------------------------------------------------------------ counters forward

  describe('counters only move forward', () => {
    it('number_series and token_counters refuse a decrease (owner too) and allow an increase', async () => {
      await owner.numberSeries.create({
        data: { tenantId: A.tenant, series: 'BILL', periodYear: 2026, lastNumber: 5n },
      });
      await owner.tokenCounter.create({
        data: {
          tenantId: A.tenant,
          branchId: A.mainBranch,
          tokenDate: new Date('2026-03-01'),
          lastToken: 5,
        },
      });
      await asOwner(async (c) => {
        await expect(
          c.query(`UPDATE number_series SET last_number = 4 WHERE tenant_id = $1`, [A.tenant]),
        ).rejects.toThrow(/forward/i);
        await expect(
          c.query(`UPDATE token_counters SET last_token = 4 WHERE tenant_id = $1`, [A.tenant]),
        ).rejects.toThrow(/forward/i);
        await c.query(`UPDATE number_series SET last_number = 6 WHERE tenant_id = $1`, [A.tenant]);
        await c.query(`UPDATE token_counters SET last_token = 6 WHERE tenant_id = $1`, [A.tenant]);
        await c.query(`UPDATE number_series SET last_number = 6 WHERE tenant_id = $1`, [A.tenant]);
      });
      await inTenant(A.tenant, async (c) => {
        await expect(
          c.query(`UPDATE number_series SET last_number = 1 WHERE tenant_id = $1`, [A.tenant]),
        ).rejects.toThrow(/forward/i);
      });
    });
  });

  // ------------------------------------------------ hardening found by the adversarial review

  describe('hardening (attacks from the self-review)', () => {
    it('the trigger tenant check cannot be skipped by emptying the session tenant', async () => {
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      // App login, session tenant emptied: must not reach (or describe) another hospital's bill.
      const c = createPgClient('app');
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id', '', true)`);
        await expect(pay(c, { f: A, bill: made.bill, amount: 1_000_000 })).rejects.toThrow(
          /tenant mismatch/i,
        );
        await c.query('ROLLBACK');
        // And with no GUC at all.
        await c.query('BEGIN');
        await c.query(`RESET app.tenant_id`);
        await expect(pay(c, { f: A, bill: made.bill, amount: 1 })).rejects.toThrow(
          /tenant mismatch/i,
        );
        await c.query('ROLLBACK');
      } finally {
        await c.end();
      }
    });

    it('bills, lines and registration records cannot be written for another hospital', async () => {
      const mine = await inTenant(A.tenant, (c) =>
        newBill(c, { f: A, patient: patientFor(A), withRegistration: true }),
      );
      const lineOfA = (
        await inTenant(A.tenant, (c) =>
          c.query<{ id: string }>(`SELECT id FROM bill_lines WHERE bill_id = $1 AND line_no = 2`, [
            mine.bill,
          ]),
        )
      ).rows[0]!.id;

      // From B's session, with A's tenant id on every row.
      await expect(
        inTenant(B.tenant, async (c) => {
          const visit = await insertVisit(c, { f: B, patient: B.patients[0]! });
          await insertBill(c, { f: A, visit, subtotal: 100 });
        }),
      ).rejects.toThrow();
      await expect(
        inTenant(B.tenant, (c) =>
          insertLine(c, { f: A, bill: mine.bill, lineNo: 9, kind: 'INVESTIGATION', unit: 1 }),
        ),
      ).rejects.toThrow();
      await expect(
        inTenant(B.tenant, (c) => insertRegistrationRecord(c, A, A.patients[0]!, lineOfA)),
      ).rejects.toThrow();
      // Nothing of the above changed A's bill.
      expect((await billState(A, mine.bill)).total).toBe(mine.total);
    });

    it('forging the ledger flag by hand gives the app role nothing (no UPDATE right on bills)', async () => {
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await expect(
        inTenant(A.tenant, async (c) => {
          await c.query(`SELECT set_config('hospigo.ledger_update', 'on', true)`);
          await c.query(
            `UPDATE bills SET paid_paise = total_paise, payment_status = 'PAID' WHERE id = $1`,
            [made.bill],
          );
        }),
      ).rejects.toThrow(/permission denied/i);
      expect(await billState(A, made.bill)).toMatchObject({ paid: 0, status: 'UNPAID' });
    });

    it('PARALLEL: five consultation bills for one visit -> exactly one is created', async () => {
      const visit = await inTenant(A.tenant, (c) =>
        insertVisit(c, { f: A, patient: patientFor(A) }),
      );
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          inTenant(A.tenant, async (c) => {
            const bill = await insertBill(c, { f: A, visit, subtotal: 100 });
            await insertLine(c, { f: A, bill, lineNo: 1, kind: 'CONSULTATION', unit: 100 });
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('PARALLEL: the registration fee of one patient is charged once across branches', async () => {
      const patient = patientFor(A);
      const results = await Promise.allSettled(
        [A.mainBranch, A.eastBranch, A.mainBranch, A.eastBranch].map((branch) =>
          inTenant(A.tenant, (c) => newBill(c, { f: A, patient, branch, withRegistration: true })),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('a payment with the amount of another currency unit cannot overflow the bill (integer limits)', async () => {
      const made = await inTenant(A.tenant, (c) => newBill(c, { f: A, patient: patientFor(A) }));
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 2_147_483_647 })),
      ).rejects.toThrow(/exceeds/i);
      await expect(
        inTenant(A.tenant, (c) => pay(c, { f: A, bill: made.bill, amount: 2_147_483_648 })),
      ).rejects.toThrow(/out of range|integer/i);
      expect((await billState(A, made.bill)).paid).toBe(0);
    });
  });

  // --------------------------------------------------------- Prisma models mirror the tables

  describe('clinical rows: note, addenda, vitals, prescription (Step 5a)', () => {
    let tokenSeq = 30_000;
    let pulseA: { id: string; code: string; name: string; unit: string };
    let postureA: { id: string; code: string; name: string; unit: string };
    let medicineA: { id: string; name: string };
    let medicineB: { id: string };
    let doctorUserA: string;
    let otherDoctorA: string;

    beforeAll(async () => {
      doctorUserA = (
        await owner.doctorProfile.findUniqueOrThrow({ where: { id: A.doctorProfile } })
      ).userId;
      const otherUser = await owner.user.create({
        data: {
          tenantId: A.tenant,
          code: `OD${stamp}`,
          email: `vb_other_doc_${stamp}@example.test`,
          displayName: 'Other Doctor',
          passwordHash: 'x',
        },
      });
      otherDoctorA = (
        await owner.doctorProfile.create({
          data: { tenantId: A.tenant, userId: otherUser.id, code: `ODOC${stamp}` },
        })
      ).id;
      pulseA = await owner.vitalsField.create({
        data: {
          tenantId: A.tenant,
          code: 'PULSE',
          name: 'Pulse',
          unit: 'bpm',
          valueKind: 'NUMBER',
        },
      });
      postureA = await owner.vitalsField.create({
        data: {
          tenantId: A.tenant,
          code: 'POSTURE',
          name: 'Posture',
          unit: '-',
          valueKind: 'TEXT',
        },
      });
      medicineA = await owner.medicine.create({
        data: { tenantId: A.tenant, code: 'PARA', name: 'Paracetamol 500' },
      });
      medicineB = await owner.medicine.create({
        data: { tenantId: B.tenant, code: 'PARA', name: 'Paracetamol 500' },
      });
    });

    /** A visit in the wanted state, made the way the API does it (bill, payment, queue, start). */
    async function visitIn(
      f: Fixture,
      status: 'AWAITING_PAYMENT' | 'WAITING' | 'IN_CONSULTATION',
    ): Promise<string> {
      return inTenant(f.tenant, async (c) => {
        const made = await newBill(c, { f, patient: patientFor(f) });
        if (status === 'AWAITING_PAYMENT') {
          return made.visit;
        }
        await pay(c, { f, bill: made.bill, amount: made.total });
        await queueVisit(c, made.visit, (tokenSeq += 1));
        if (status === 'IN_CONSULTATION') {
          await c.query(
            `UPDATE opd_visits SET status='IN_CONSULTATION', consultation_started_at=now(), updated_at=now() WHERE id=$1`,
            [made.visit],
          );
        }
        return made.visit;
      });
    }

    async function insertNote(
      c: Client,
      visit: string,
      o: { doctor?: string; status?: string; completedAt?: string; diagnosis?: string | null } = {},
    ): Promise<string> {
      const r = await c.query<{ id: string }>(
        `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id, status,
                                    diagnosis, completed_at)
         SELECT gen_random_uuid()::text, tenant_id, branch_id, id, COALESCE($2, doctor_profile_id),
                COALESCE($3, 'DRAFT')::consultation_status, $4, $5::timestamptz
           FROM opd_visits WHERE id = $1
         RETURNING id`,
        [
          visit,
          o.doctor ?? null,
          o.status ?? null,
          o.diagnosis === undefined ? 'dx' : o.diagnosis,
          o.completedAt ?? null,
        ],
      );
      return r.rows[0]!.id;
    }

    const finishNote = (c: Client, note: string) =>
      c.query(
        `UPDATE consultations SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
        [note],
      );

    async function insertAddendum(
      c: Client,
      note: string,
      o: { by?: string; text?: string; reason?: string } = {},
    ) {
      return c.query(
        `INSERT INTO consultation_addenda (id, tenant_id, branch_id, consultation_id, visit_id,
                                           addendum_text, reason, added_by)
         SELECT gen_random_uuid()::text, tenant_id, branch_id, id, visit_id, $2, $3, $4
           FROM consultations WHERE id = $1`,
        [note, o.text ?? 'extra advice', o.reason ?? 'forgot to add', o.by ?? doctorUserA],
      );
    }

    async function insertVitals(
      c: Client,
      visit: string,
      field: { id: string; code: string; name: string; unit: string },
      o: {
        version?: number;
        number?: number | null;
        text?: string | null;
        reason?: string | null;
        kind?: 'NUMBER' | 'TEXT';
        unit?: string;
        by?: string;
      } = {},
    ) {
      const kind = o.kind ?? (field.code === 'POSTURE' ? 'TEXT' : 'NUMBER');
      return c.query(
        `INSERT INTO visit_vitals (id, tenant_id, branch_id, visit_id, vitals_field_id, version,
                                   field_code, field_name, unit, value_kind, value_number,
                                   value_text, correction_reason, recorded_by)
         SELECT gen_random_uuid()::text, tenant_id, branch_id, id, $2, $3, $4, $5, $6,
                $7::vitals_value_kind, $8, $9, $10, $11
           FROM opd_visits WHERE id = $1`,
        [
          visit,
          field.id,
          o.version ?? 1,
          field.code,
          field.name,
          o.unit ?? field.unit,
          kind,
          o.number === undefined ? (kind === 'NUMBER' ? 72 : null) : o.number,
          o.text === undefined ? (kind === 'TEXT' ? 'sitting' : null) : o.text,
          o.reason ?? null,
          o.by ?? A.user,
        ],
      );
    }

    async function insertRx(
      c: Client,
      note: string,
      o: {
        line?: number;
        medicine?: string | null;
        name?: string;
        unlisted?: boolean;
        dose?: string;
      } = {},
    ) {
      const medicine = o.medicine === undefined ? medicineA.id : o.medicine;
      return c.query(
        `INSERT INTO prescription_items (id, tenant_id, branch_id, visit_id, consultation_id, line_no,
                                         medicine_id, medicine_name, is_unlisted, dose, frequency, duration)
         SELECT gen_random_uuid()::text, tenant_id, branch_id, visit_id, id, $2, $3, $4, $5, $6,
                'twice a day', '5 days'
           FROM consultations WHERE id = $1`,
        [
          note,
          o.line ?? 1,
          medicine,
          o.name ?? (medicine === null ? 'Home remedy' : medicineA.name),
          o.unlisted ?? medicine === null,
          o.dose ?? '1 tablet',
        ],
      );
    }

    it('a note can only be started while the visit is IN_CONSULTATION, once', async () => {
      const unpaid = await visitIn(A, 'AWAITING_PAYMENT');
      const waiting = await visitIn(A, 'WAITING');
      const started = await visitIn(A, 'IN_CONSULTATION');
      for (const visit of [unpaid, waiting]) {
        await expect(inTenant(A.tenant, (c) => insertNote(c, visit))).rejects.toThrow(
          /in consultation/i,
        );
      }
      await inTenant(A.tenant, (c) => insertNote(c, started));
      await expect(inTenant(A.tenant, (c) => insertNote(c, started))).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });

    it('a note belongs to the doctor of the visit and always starts as a draft', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      await expect(
        inTenant(A.tenant, (c) => insertNote(c, visit, { doctor: otherDoctorA })),
      ).rejects.toThrow(/doctor of the visit/i);
      await expect(
        inTenant(A.tenant, (c) =>
          insertNote(c, visit, { status: 'COMPLETED', completedAt: new Date().toISOString() }),
        ),
      ).rejects.toThrow(/starts as a draft/i);
      // a visit of another branch cannot get a note of this branch's id mix-up either
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(
            `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id)
             SELECT gen_random_uuid()::text, tenant_id, $2, id, doctor_profile_id
               FROM opd_visits WHERE id = $1`,
            [visit, A.eastBranch],
          ),
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('a draft can change, a finished note needs text, and a COMPLETED note is frozen', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit, { diagnosis: null }));
      await inTenant(A.tenant, (c) =>
        c.query(`UPDATE consultations SET complaints = 'cough', updated_at = now() WHERE id = $1`, [
          note,
        ]),
      );
      // complaints or diagnosis must hold something to finish
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE consultations SET complaints = '   ', status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1`,
            [note],
          ),
        ),
      ).rejects.toThrow(/check|violates/i);
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE consultations SET status = 'COMPLETED', updated_at = now() WHERE id = $1`,
            [note],
          ),
        ),
      ).rejects.toThrow(/check|violates/i);
      await inTenant(A.tenant, (c) => finishNote(c, note));

      for (const run of [
        inTenant.bind(null, A.tenant),
        (fn: (c: Client) => Promise<unknown>) => asOwner(fn),
      ]) {
        await expect(
          run((c: Client) =>
            c.query(`UPDATE consultations SET advice = 'x', updated_at = now() WHERE id = $1`, [
              note,
            ]),
          ),
        ).rejects.toThrow(/completed note cannot be changed/i);
      }
      await expect(
        asOwner((c) => c.query(`DELETE FROM consultations WHERE id = $1`, [note])),
      ).rejects.toThrow(/append-only/i);
      await expect(
        inTenant(A.tenant, (c) => c.query(`DELETE FROM consultations WHERE id = $1`, [note])),
      ).rejects.toThrow(/permission denied/i);
    });

    it('identity columns of a note cannot be changed (app has no privilege; owner is stopped)', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(`UPDATE consultations SET doctor_profile_id = $2 WHERE id = $1`, [
            note,
            otherDoctorA,
          ]),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asOwner((c) =>
          c.query(`UPDATE consultations SET doctor_profile_id = $2 WHERE id = $1`, [
            note,
            otherDoctorA,
          ]),
        ),
      ).rejects.toThrow(/immutable/i);
    });

    it('a visit becomes COMPLETED only after its note is COMPLETED', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const complete = () =>
        inTenant(A.tenant, (c) =>
          c.query(
            `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
            [visit],
          ),
        );
      await expect(complete()).rejects.toThrow(/note is completed/i);
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await expect(complete()).rejects.toThrow(/note is completed/i);
      await inTenant(A.tenant, (c) => finishNote(c, note));
      await complete();
    });

    it('addenda: only on a COMPLETED note, only by the visit doctor, append-only, never blank', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await expect(inTenant(A.tenant, (c) => insertAddendum(c, note))).rejects.toThrow(
        /completed note/i,
      );
      await inTenant(A.tenant, (c) => finishNote(c, note));
      await expect(
        inTenant(A.tenant, (c) => insertAddendum(c, note, { by: A.user })),
      ).rejects.toThrow(/only the doctor of the visit/i);
      await expect(
        inTenant(A.tenant, (c) => insertAddendum(c, note, { text: '  ' })),
      ).rejects.toThrow(/check|violates/i);
      await expect(
        inTenant(A.tenant, (c) => insertAddendum(c, note, { reason: '' })),
      ).rejects.toThrow(/check|violates/i);
      await inTenant(A.tenant, (c) => insertAddendum(c, note));
      await inTenant(A.tenant, (c) => insertAddendum(c, note, { text: 'second correction' }));
      for (const run of [
        inTenant.bind(null, A.tenant),
        (fn: (c: Client) => Promise<unknown>) => asOwner(fn),
      ]) {
        await expect(
          run((c: Client) => c.query(`UPDATE consultation_addenda SET reason = 'x'`)),
        ).rejects.toThrow(/append-only|permission denied/i);
        await expect(
          run((c: Client) => c.query(`DELETE FROM consultation_addenda`)),
        ).rejects.toThrow(/append-only|permission denied/i);
      }
    });

    it('vitals: only for a visit that has joined the queue', async () => {
      const unpaid = await visitIn(A, 'AWAITING_PAYMENT');
      const waiting = await visitIn(A, 'WAITING');
      await expect(inTenant(A.tenant, (c) => insertVitals(c, unpaid, pulseA))).rejects.toThrow(
        /joined the queue/i,
      );
      await inTenant(A.tenant, (c) => insertVitals(c, waiting, pulseA));
      await inTenant(A.tenant, (c) => insertVitals(c, waiting, postureA));
    });

    it('vitals: gapless versions, a correction needs a reason, the copy must be true', async () => {
      const visit = await visitIn(A, 'WAITING');
      await expect(
        inTenant(A.tenant, (c) => insertVitals(c, visit, pulseA, { version: 2, reason: 'typo' })),
      ).rejects.toThrow(/follow the latest/i);
      await inTenant(A.tenant, (c) => insertVitals(c, visit, pulseA));
      await expect(
        inTenant(A.tenant, (c) => insertVitals(c, visit, pulseA, { version: 2, number: 80 })),
      ).rejects.toThrow(/check|violates/i);
      await expect(
        inTenant(A.tenant, (c) =>
          insertVitals(c, visit, pulseA, { version: 2, number: 80, reason: '   ' }),
        ),
      ).rejects.toThrow(/check|violates/i);
      await inTenant(A.tenant, (c) =>
        insertVitals(c, visit, pulseA, { version: 2, number: 80, reason: 'wrong cuff' }),
      );
      await expect(
        inTenant(A.tenant, (c) =>
          insertVitals(c, visit, pulseA, { version: 2, number: 81, reason: 'again' }),
        ),
      ).rejects.toThrow(/follow the latest|duplicate key/i);
      await inTenant(A.tenant, (c) =>
        insertVitals(c, visit, pulseA, { version: 3, number: 78, reason: 'rechecked' }),
      );
      // the unit (or name, or kind) is a copy of the master: a lie is refused
      const other = await visitIn(A, 'WAITING');
      await expect(
        inTenant(A.tenant, (c) => insertVitals(c, other, pulseA, { unit: 'mmHg' })),
      ).rejects.toThrow(/true copy/i);
    });

    it('vitals: a number field holds a number, a text field holds text', async () => {
      const visit = await visitIn(A, 'WAITING');
      await expect(
        inTenant(A.tenant, (c) =>
          insertVitals(c, visit, pulseA, { kind: 'NUMBER', number: null, text: 'fast' }),
        ),
      ).rejects.toThrow(/check|violates/i);
      await expect(
        inTenant(A.tenant, (c) =>
          insertVitals(c, visit, postureA, { kind: 'TEXT', text: '   ', number: null }),
        ),
      ).rejects.toThrow(/check|violates/i);
      await expect(
        inTenant(A.tenant, (c) =>
          insertVitals(c, visit, postureA, { kind: 'TEXT', text: 'sitting', number: 5 }),
        ),
      ).rejects.toThrow(/check|violates/i);
    });

    it('vitals are append-only and can still be corrected after the visit is COMPLETED', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      await inTenant(A.tenant, (c) => insertVitals(c, visit, pulseA));
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await inTenant(A.tenant, async (c) => {
        await finishNote(c, note);
        await c.query(
          `UPDATE opd_visits SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1`,
          [visit],
        );
      });
      await inTenant(A.tenant, (c) =>
        insertVitals(c, visit, pulseA, { version: 2, number: 75, reason: 'rechecked later' }),
      );
      for (const run of [
        inTenant.bind(null, A.tenant),
        (fn: (c: Client) => Promise<unknown>) => asOwner(fn),
      ]) {
        await expect(
          run((c: Client) => c.query(`UPDATE visit_vitals SET value_number = 1`)),
        ).rejects.toThrow(/append-only|permission denied/i);
        await expect(run((c: Client) => c.query(`DELETE FROM visit_vitals`))).rejects.toThrow(
          /append-only|permission denied/i,
        );
      }
    });

    it('prescription: listed rows are a true copy of the medicines list, free text is flagged unlisted', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await expect(
        inTenant(A.tenant, (c) => insertRx(c, note, { name: 'Something else' })),
      ).rejects.toThrow(/true copy/i);
      await inTenant(A.tenant, (c) => insertRx(c, note));
      await inTenant(A.tenant, (c) => insertRx(c, note, { line: 2, medicine: null }));
      // a listed row cannot claim to be unlisted, and free text cannot claim to be listed
      await expect(
        inTenant(A.tenant, (c) => insertRx(c, note, { line: 3, unlisted: true })),
      ).rejects.toThrow(/check|violates/i);
      await expect(
        inTenant(A.tenant, (c) => insertRx(c, note, { line: 3, medicine: null, unlisted: false })),
      ).rejects.toThrow(/check|violates/i);
      // one row per line number, and a medicine of ANOTHER hospital is refused
      await expect(inTenant(A.tenant, (c) => insertRx(c, note, { line: 2 }))).rejects.toThrow(
        /duplicate key|unique/i,
      );
      await expect(
        inTenant(A.tenant, (c) => insertRx(c, note, { line: 3, medicine: medicineB.id })),
      ).rejects.toThrow(/foreign key|true copy/i);
      await expect(
        inTenant(A.tenant, (c) => insertRx(c, note, { line: 3, dose: '  ' })),
      ).rejects.toThrow(/check|violates/i);
      for (const run of [
        inTenant.bind(null, A.tenant),
        (fn: (c: Client) => Promise<unknown>) => asOwner(fn),
      ]) {
        await expect(
          run((c: Client) => c.query(`UPDATE prescription_items SET dose = 'x'`)),
        ).rejects.toThrow(/append-only|permission denied/i);
      }
    });

    it('prescription: rows can be replaced while the note is a draft and are frozen once it is completed', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await inTenant(A.tenant, (c) => insertRx(c, note));
      await inTenant(A.tenant, (c) =>
        c.query(`DELETE FROM prescription_items WHERE consultation_id = $1`, [note]),
      );
      await inTenant(A.tenant, (c) => insertRx(c, note));
      await inTenant(A.tenant, (c) => finishNote(c, note));
      await expect(inTenant(A.tenant, (c) => insertRx(c, note, { line: 2 }))).rejects.toThrow(
        /completed note/i,
      );
      await expect(
        inTenant(A.tenant, (c) =>
          c.query(`DELETE FROM prescription_items WHERE consultation_id = $1`, [note]),
        ),
      ).rejects.toThrow(/completed note/i);
      await expect(
        asOwner((c) =>
          c.query(`DELETE FROM prescription_items WHERE consultation_id = $1`, [note]),
        ),
      ).rejects.toThrow(/completed note/i);
    });

    it('a prescription row cannot slip in while the note is being completed (row lock)', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      const completer = createPgClient('app');
      const writer = createPgClient('app');
      await completer.connect();
      await writer.connect();
      try {
        for (const c of [completer, writer]) {
          await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [A.tenant]);
        }
        await completer.query('BEGIN');
        await finishNote(completer, note); // holds the row lock, not committed yet
        await writer.query('BEGIN');
        const slipIn = insertRx(writer, note); // waits for the lock
        await new Promise((resolve) => setTimeout(resolve, 400));
        await completer.query('COMMIT');
        await expect(slipIn).rejects.toThrow(/completed note/i);
        await writer.query('ROLLBACK');
      } finally {
        await completer.end();
        await writer.end();
      }
    });

    it('another hospital can neither see nor write clinical rows of this one', async () => {
      const visit = await visitIn(A, 'IN_CONSULTATION');
      const note = await inTenant(A.tenant, (c) => insertNote(c, visit));
      await inTenant(A.tenant, (c) => insertRx(c, note));
      await inTenant(A.tenant, (c) => finishNote(c, note));
      await inTenant(A.tenant, (c) => insertAddendum(c, note));
      const seen = await inTenant(B.tenant, async (c) => {
        const out: Record<string, number> = {};
        for (const t of [
          'consultations',
          'consultation_addenda',
          'visit_vitals',
          'prescription_items',
        ]) {
          out[t] = (
            await c.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM ${t} WHERE tenant_id = $1`,
              [A.tenant],
            )
          ).rows.map((r) => Number(r.n))[0]!;
        }
        return out;
      });
      expect(seen).toEqual({
        consultations: 0,
        consultation_addenda: 0,
        visit_vitals: 0,
        prescription_items: 0,
      });
      // hospital B writing a note for hospital A's visit: refused (row level security)
      const stolen = await visitIn(A, 'IN_CONSULTATION');
      await expect(
        inTenant(B.tenant, (c) =>
          c.query(
            `INSERT INTO consultations (id, tenant_id, branch_id, visit_id, doctor_profile_id)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
            [A.tenant, A.mainBranch, stolen, A.doctorProfile],
          ),
        ),
      ).rejects.toThrow(/row-level security|in consultation/i);
      expect(await owner.consultation.count({ where: { visitId: stolen } })).toBe(0);
    });

    it('hospigo_hq and hospigo_patient have no privileges on the clinical tables', async () => {
      await asOwner(async (c) => {
        for (const role of ['hospigo_hq', 'hospigo_patient']) {
          for (const table of [
            'consultations',
            'consultation_addenda',
            'visit_vitals',
            'prescription_items',
          ]) {
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
      });
    });
  });

  describe('Prisma models match the migration', () => {
    it('creates a visit, bill, lines and payment through the app client and reads the result', async () => {
      const result = await asHospital(A.tenant, () =>
        tenantDb.withTenant(async (tx) => {
          const patient = A.patients[11]!;
          const visit = await tx.opdVisit.create({
            data: {
              tenantId: A.tenant,
              branchId: A.mainBranch,
              patientId: patient,
              doctorProfileId: A.doctorProfile,
              visitType: 'NEW',
              visitDate: new Date('2026-11-18'),
              createdBy: A.user,
            },
          });
          const bill = await tx.bill.create({
            data: {
              tenantId: A.tenant,
              branchId: A.mainBranch,
              visitId: visit.id,
              billType: 'CONSULTATION',
              billNumber: unique('PRISMA'),
              subtotalPaise: CONSULTATION_FEE,
              totalPaise: CONSULTATION_FEE,
              idempotencyKey: unique('PK'),
              createdBy: A.user,
            },
          });
          await tx.billLine.create({
            data: {
              tenantId: A.tenant,
              billId: bill.id,
              lineNo: 1,
              kind: 'CONSULTATION',
              doctorFeeId: A.doctorFee,
              codeSnapshot: 'CONS',
              descriptionSnapshot: 'Consultation',
              unitPricePaise: CONSULTATION_FEE,
              lineTotalPaise: CONSULTATION_FEE,
            },
          });
          const receipt = await tx.receipt.create({
            data: {
              tenantId: A.tenant,
              billId: bill.id,
              branchId: A.mainBranch,
              receiptNumber: unique('PR'),
              totalPaise: CONSULTATION_FEE,
              issuedBy: A.user,
              idempotencyKey: unique('PRK'),
            },
          });
          await tx.payment.create({
            data: {
              tenantId: A.tenant,
              billId: bill.id,
              branchId: A.mainBranch,
              receiptId: receipt.id,
              paymentModeId: A.cash,
              amountPaise: CONSULTATION_FEE,
              receivedBy: A.user,
              idempotencyKey: unique('PPK'),
            },
          });
          return { visitId: visit.id, billId: bill.id };
        }),
      );
      const read = await asHospital(A.tenant, () =>
        tenantDb.withTenant(async (tx) => ({
          bill: await tx.bill.findUniqueOrThrow({ where: { id: result.billId } }),
          ledger: await tx.ledgerEntry.findMany({
            where: { billId: result.billId },
            orderBy: { postedAt: 'asc' },
          }),
          visit: await tx.opdVisit.findUniqueOrThrow({ where: { id: result.visitId } }),
        })),
      );
      expect(read.bill).toMatchObject({
        paidPaise: CONSULTATION_FEE,
        paymentStatus: 'PAID',
        refundedPaise: 0,
      });
      expect(read.ledger.map((l) => l.entryType).sort()).toEqual(['CHARGE', 'PAYMENT']);
      expect(read.visit.status).toBe('AWAITING_PAYMENT');

      // The app client cannot update a bill through Prisma either.
      await expect(
        asHospital(A.tenant, () =>
          tenantDb.withTenant((tx) =>
            tx.bill.update({ where: { id: result.billId }, data: { paidPaise: 0 } }),
          ),
        ),
      ).rejects.toThrow();
    });
  });
});
