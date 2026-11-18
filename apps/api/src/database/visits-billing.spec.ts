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
    for (let i = 0; i < 12; i += 1) {
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
      receipt?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO payments (id, tenant_id, bill_id, branch_id, receipt_number, payment_mode_id,
                             amount_paise, reference_no, received_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        o.f.tenant,
        o.bill,
        o.branch ?? o.f.mainBranch,
        o.receipt ?? unique('RCPT'),
        o.mode ?? o.f.cash,
        o.amount,
        o.reference ?? null,
        o.f.user,
        o.key ?? unique('PK'),
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
      // Cancel needs a reason; completion needs completed_at.
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
          await tx.payment.create({
            data: {
              tenantId: A.tenant,
              billId: bill.id,
              branchId: A.mainBranch,
              receiptNumber: unique('PR'),
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
