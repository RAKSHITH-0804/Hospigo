import type { TenantTx } from '../../database/tenant-db';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { isRealDate } from '../opd-prices/local-date';
import { planPriceChange } from '../opd-prices/price-plan';
import type { PriceVisitType } from '../opd-prices/opd-prices.config';
import { IMPORT_LIMITS, type ImportTypeCode } from './import.config';
import type { ParsedSheet, RawCell } from './xlsx-file';

/** Step 8b, part C: what each Excel row means, checked against the hospital's data. */

const MAX_PAISE = 2_147_483_647;

export type RowIssue = { reason: string; field: string };
export type RowAction = 'CREATE' | 'UPDATE' | 'NONE';

export type TestData = {
  kind: 'TESTS';
  code: string;
  name: string;
  active: boolean;
  amountPaise: number | null;
  startDate: string | null;
};
export type FeeData = {
  kind: 'DOCTOR_FEES';
  doctorCode: string;
  doctorProfileId: string;
  visitType: PriceVisitType;
  amountPaise: number;
  startDate: string | null;
  /** Step 9: the branch the fee is for (null = the doctor's hospital-wide fee). */
  branchId?: string | null;
  branchCode?: string;
};
export type MedicineData = {
  kind: 'MEDICINES';
  code: string;
  name: string;
  composition: string | null;
  form: string | null;
  active: boolean;
};
export type RowData = TestData | FeeData | MedicineData;

export type PreparedRow = {
  rowNumber: number;
  matchKey: string;
  /** The source row as text/numbers (an audit copy; never read back by this logic). */
  raw: Record<string, string | number | boolean | null>;
  issue: RowIssue | null;
  action: RowAction | null;
  data: RowData | null;
};

type Latest = { amountPaise: number; effectiveFrom: Date };

export type ImportContext = {
  now: Date;
  timeZone: string;
  tests: Map<
    string,
    { id: string; kind: string; name: string; active: boolean; latest: Latest | null }
  >;
  doctors: Map<string, { id: string; active: boolean }>;
  /** Latest saved fee per doctor, visit type and scope: `doctorId|TYPE|branchId` (branch id empty = hospital-wide). */
  fees: Map<string, Latest>;
  /** Doctors who already have a saved new-visit fee in any scope. */
  newFeeDoctors: Set<string>;
  /** The hospital's branches by lower-case code. */
  branches: Map<string, { id: string }>;
  /** `doctorId|branchId` of every active branch link of the listed doctors. */
  doctorBranches: Set<string>;
  /** What the uploader may set: hospital-wide (and any branch), or only these branches. */
  feeScope: { wide: boolean; branches: ReadonlySet<string> };
  medicines: Map<
    string,
    { id: string; name: string; composition: string | null; form: string | null; active: boolean }
  >;
};

// ------------------------------------------------------------------------------ cell readers

function jsonSafe(value: RawCell): string | number | boolean | null {
  if (value === null) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? '[date]' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') return 'formula' in value ? '[formula]' : '[error]';
  return value;
}

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

function textOf(cell: RawCell, max: number): Read<string> {
  if (cell === null) return { ok: true, value: '' };
  let text: string;
  if (typeof cell === 'string') text = cell.trim();
  else if (typeof cell === 'number' && Number.isFinite(cell)) text = String(cell);
  else return { ok: false, reason: 'TEXT_INVALID' };
  if (text.length > max || text.length > IMPORT_LIMITS.cellMax) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, value: text };
}

/** Rupees as typed (whole rupees, or up to two decimals) to whole paise; nothing else is accepted. */
function amountOf(cell: RawCell): Read<number | null> {
  if (cell === null) return { ok: true, value: null };
  let text: string;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell < 0) return { ok: false, reason: 'PRICE_INVALID' };
    text = String(cell);
  } else if (typeof cell === 'string') {
    text = cell.trim();
  } else {
    return { ok: false, reason: 'PRICE_INVALID' };
  }
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return { ok: false, reason: 'PRICE_INVALID' };
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (paise > MAX_PAISE) return { ok: false, reason: 'PRICE_INVALID' };
  return { ok: true, value: paise };
}

function dateOf(cell: RawCell): Read<string | null> {
  if (cell === null) return { ok: true, value: null };
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return { ok: false, reason: 'DATE_INVALID' };
    return { ok: true, value: cell.toISOString().slice(0, 10) };
  }
  if (
    typeof cell === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(cell.trim()) &&
    isRealDate(cell.trim())
  ) {
    return { ok: true, value: cell.trim() };
  }
  return { ok: false, reason: 'DATE_INVALID' };
}

function activeOf(cell: RawCell): Read<boolean> {
  if (cell === null) return { ok: true, value: true };
  if (typeof cell === 'boolean') return { ok: true, value: cell };
  if (typeof cell === 'number' && (cell === 0 || cell === 1))
    return { ok: true, value: cell === 1 };
  if (typeof cell === 'string') {
    const t = cell.trim().toLowerCase();
    if (['yes', 'y', 'true', '1', 'active'].includes(t)) return { ok: true, value: true };
    if (['no', 'n', 'false', '0', 'inactive'].includes(t)) return { ok: true, value: false };
  }
  return { ok: false, reason: 'ACTIVE_INVALID' };
}

function visitTypeOf(cell: RawCell): Read<PriceVisitType> {
  if (typeof cell === 'string') {
    const t = cell
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (t === 'NEW' || t === 'FOLLOW_UP') return { ok: true, value: t };
  }
  return { ok: false, reason: 'VISIT_TYPE_INVALID' };
}

function codeOf(cell: RawCell, max: number): Read<string> {
  const t = textOf(cell, max);
  if (!t.ok) return { ok: false, reason: 'CODE_INVALID' };
  if (t.value === '') return { ok: false, reason: 'CODE_REQUIRED' };
  if (!IMPORT_LIMITS.codePattern.test(t.value)) return { ok: false, reason: 'CODE_INVALID' };
  return { ok: true, value: t.value };
}

// -------------------------------------------------------------------------- row preparation

function firstCellProblem(cells: Record<string, RawCell>): RowIssue | null {
  for (const [field, value] of Object.entries(cells)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      return { reason: 'formula' in value ? 'FORMULA_NOT_ALLOWED' : 'CELL_ERROR', field };
    }
  }
  return null;
}

function prepareTest(row: ParsedSheet['rows'][number], ctx: ImportContext): PreparedRow {
  const c = row.cells;
  const raw = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, jsonSafe(v)]));
  const fail = (field: string, reason: string, key = ''): PreparedRow => ({
    rowNumber: row.rowNumber,
    matchKey: key || `row-${row.rowNumber}`,
    raw,
    issue: { reason, field },
    action: null,
    data: null,
  });
  const problem = firstCellProblem(c);
  if (problem) return fail(problem.field, problem.reason);
  const code = codeOf(c.code ?? null, IMPORT_LIMITS.codeMax);
  if (!code.ok) return fail('code', code.reason);
  const name = textOf(c.name ?? null, IMPORT_LIMITS.nameMax);
  if (!name.ok) return fail('name', name.reason, code.value);
  if (name.value === '') return fail('name', 'NAME_REQUIRED', code.value);
  const active = activeOf(c.active ?? null);
  if (!active.ok) return fail('active', active.reason, code.value);
  const price = amountOf(c.price ?? null);
  if (!price.ok) return fail('price', price.reason, code.value);
  if (price.value === null && active.value) return fail('price', 'PRICE_REQUIRED', code.value);
  const start = dateOf(c.startDate ?? null);
  if (!start.ok) return fail('startDate', start.reason, code.value);

  const item = ctx.tests.get(code.value);
  if (item && item.kind !== 'INVESTIGATION') {
    return fail('code', 'CODE_USED_BY_OTHER_ITEM', code.value);
  }
  let priceChanges = false;
  if (active.value && price.value !== null) {
    const plan = planPriceChange({
      requested: start.value ?? undefined,
      now: ctx.now,
      timeZone: ctx.timeZone,
      latest: item?.latest ?? null,
      amountPaise: price.value,
    });
    if (plan.kind === 'invalid') return fail('startDate', plan.reason, code.value);
    priceChanges = plan.kind === 'new';
  }
  const data: TestData = {
    kind: 'TESTS',
    code: code.value,
    name: name.value,
    active: active.value,
    amountPaise: active.value ? price.value : null,
    startDate: start.value,
  };
  const action: RowAction = !item
    ? 'CREATE'
    : item.name !== name.value || item.active !== active.value || priceChanges
      ? 'UPDATE'
      : 'NONE';
  return { rowNumber: row.rowNumber, matchKey: code.value, raw, issue: null, action, data };
}

function prepareFee(row: ParsedSheet['rows'][number], ctx: ImportContext): PreparedRow {
  const c = row.cells;
  const raw = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, jsonSafe(v)]));
  const fail = (field: string, reason: string, key = ''): PreparedRow => ({
    rowNumber: row.rowNumber,
    matchKey: key || `row-${row.rowNumber}`,
    raw,
    issue: { reason, field },
    action: null,
    data: null,
  });
  const problem = firstCellProblem(c);
  if (problem) return fail(problem.field, problem.reason);
  const doctorCode = textOf(c.doctorCode ?? null, IMPORT_LIMITS.codeMax);
  if (!doctorCode.ok || doctorCode.value === '') {
    return fail('doctorCode', doctorCode.ok ? 'DOCTOR_CODE_REQUIRED' : 'DOCTOR_NOT_FOUND');
  }
  const type = visitTypeOf(c.visitType ?? null);
  if (!type.ok) return fail('visitType', type.reason, doctorCode.value);
  const branchKey = textOf(c.branchCode ?? null, IMPORT_LIMITS.codeMax);
  const key = `${doctorCode.value}|${type.value}|${branchKey.ok ? branchKey.value.toLowerCase() : ''}`;
  const amount = amountOf(c.amount ?? null);
  if (!amount.ok) return fail('amount', amount.reason, key);
  if (amount.value === null) return fail('amount', 'PRICE_REQUIRED', key);
  const start = dateOf(c.startDate ?? null);
  if (!start.ok) return fail('startDate', start.reason, key);
  const doctor = ctx.doctors.get(doctorCode.value);
  if (!doctor) return fail('doctorCode', 'DOCTOR_NOT_FOUND', key);
  if (!doctor.active) return fail('doctorCode', 'DOCTOR_INACTIVE', key);
  // Step 9: blank branch code = the hospital-wide fee (hospital-wide Admin only); a code = that branch.
  const branchCell = textOf(c.branchCode ?? null, IMPORT_LIMITS.codeMax);
  if (!branchCell.ok) return fail('branchCode', branchCell.reason, key);
  const branchCode = branchCell.value;
  let branchId: string | null = null;
  if (branchCode === '') {
    if (!ctx.feeScope.wide) return fail('branchCode', 'BRANCH_SCOPE_FORBIDDEN', key);
  } else {
    const branch = ctx.branches.get(branchCode.toLowerCase());
    if (!branch) return fail('branchCode', 'BRANCH_NOT_FOUND', key);
    if (!ctx.feeScope.wide && !ctx.feeScope.branches.has(branch.id)) {
      return fail('branchCode', 'BRANCH_SCOPE_FORBIDDEN', key);
    }
    if (!ctx.doctorBranches.has(`${doctor.id}|${branch.id}`)) {
      return fail('branchCode', 'DOCTOR_NOT_IN_BRANCH', key);
    }
    branchId = branch.id;
  }
  const latest = ctx.fees.get(`${doctor.id}|${type.value}|${branchId ?? ''}`) ?? null;
  const plan = planPriceChange({
    requested: start.value ?? undefined,
    now: ctx.now,
    timeZone: ctx.timeZone,
    latest,
    amountPaise: amount.value,
  });
  if (plan.kind === 'invalid') return fail('startDate', plan.reason, key);
  const data: FeeData = {
    kind: 'DOCTOR_FEES',
    doctorCode: doctorCode.value,
    doctorProfileId: doctor.id,
    visitType: type.value,
    amountPaise: amount.value,
    startDate: start.value,
    branchId,
    branchCode,
  };
  const action: RowAction = plan.kind === 'unchanged' ? 'NONE' : latest ? 'UPDATE' : 'CREATE';
  return { rowNumber: row.rowNumber, matchKey: key, raw, issue: null, action, data };
}

function prepareMedicine(row: ParsedSheet['rows'][number], ctx: ImportContext): PreparedRow {
  const c = row.cells;
  const raw = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, jsonSafe(v)]));
  const fail = (field: string, reason: string, key = ''): PreparedRow => ({
    rowNumber: row.rowNumber,
    matchKey: key || `row-${row.rowNumber}`,
    raw,
    issue: { reason, field },
    action: null,
    data: null,
  });
  const problem = firstCellProblem(c);
  if (problem) return fail(problem.field, problem.reason);
  const code = codeOf(c.code ?? null, IMPORT_LIMITS.codeMax);
  if (!code.ok) return fail('code', code.reason);
  const name = textOf(c.name ?? null, IMPORT_LIMITS.nameMax);
  if (!name.ok) return fail('name', name.reason, code.value);
  if (name.value === '') return fail('name', 'NAME_REQUIRED', code.value);
  const composition = textOf(c.composition ?? null, IMPORT_LIMITS.compositionMax);
  if (!composition.ok) return fail('composition', composition.reason, code.value);
  const form = textOf(c.form ?? null, IMPORT_LIMITS.formMax);
  if (!form.ok) return fail('form', form.reason, code.value);
  const active = activeOf(c.active ?? null);
  if (!active.ok) return fail('active', active.reason, code.value);
  const data: MedicineData = {
    kind: 'MEDICINES',
    code: code.value,
    name: name.value,
    composition: composition.value || null,
    form: form.value || null,
    active: active.value,
  };
  const existing = ctx.medicines.get(code.value);
  const action: RowAction = !existing
    ? 'CREATE'
    : existing.name !== data.name ||
        (existing.composition ?? null) !== data.composition ||
        (existing.form ?? null) !== data.form ||
        existing.active !== data.active
      ? 'UPDATE'
      : 'NONE';
  return { rowNumber: row.rowNumber, matchKey: code.value, raw, issue: null, action, data };
}

/**
 * Checks every row. A row with a problem becomes an exception and is never saved. Rows that repeat
 * a code in the file are ALL exceptions (nobody can tell which one is meant), and a doctor needs
 * both visit types in the file.
 */
export function prepareRows(
  type: ImportTypeCode,
  sheet: ParsedSheet,
  ctx: ImportContext,
): PreparedRow[] {
  const prepare =
    type === 'TESTS' ? prepareTest : type === 'DOCTOR_FEES' ? prepareFee : prepareMedicine;
  const rows = sheet.rows.map((row) => prepare(row, ctx));

  // Only rows that are fine on their own can make each other ambiguous (a row that is already an
  // exception does not take a valid row down with it).
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.issue === null && !r.matchKey.startsWith('row-')) {
      const k = r.matchKey.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  for (const r of rows) {
    if (r.issue === null && (counts.get(r.matchKey.toLowerCase()) ?? 0) > 1) {
      r.issue = {
        reason: 'DUPLICATE_IN_FILE',
        field: type === 'DOCTOR_FEES' ? 'visitType' : 'code',
      };
      r.action = null;
      r.data = null;
    }
  }

  if (type === 'DOCTOR_FEES') {
    const kinds = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.issue === null && r.data?.kind === 'DOCTOR_FEES') {
        const k = r.data.doctorCode.toLowerCase();
        const set = kinds.get(k) ?? new Set<string>();
        set.add(r.data.visitType);
        kinds.set(k, set);
      }
    }
    for (const r of rows) {
      if (r.issue === null && r.data?.kind === 'DOCTOR_FEES') {
        // The new-visit fee is required (in the file, or already saved). The follow-up fee is optional:
        // without one, a follow-up costs the new-visit fee.
        const doctor = ctx.doctors.get(r.data.doctorCode);
        const hasNew =
          kinds.get(r.data.doctorCode.toLowerCase())?.has('NEW') === true ||
          (doctor !== undefined && ctx.newFeeDoctors.has(doctor.id));
        if (!hasNew) {
          r.issue = { reason: 'DOCTOR_NEEDS_NEW_FEE', field: 'visitType' };
          r.action = null;
          r.data = null;
        }
      }
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------ the context

/** Loads what the rows are checked against (one query per kind, never one per row). */
export async function loadContext(
  tx: TenantTx,
  tenantId: string,
  type: ImportTypeCode,
  sheet: ParsedSheet,
  now: Date,
  feeScope: ImportContext['feeScope'] = { wide: true, branches: new Set() },
): Promise<ImportContext> {
  const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
  const ctx: ImportContext = {
    now,
    timeZone: settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone,
    tests: new Map(),
    doctors: new Map(),
    fees: new Map(),
    newFeeDoctors: new Set(),
    branches: new Map(),
    doctorBranches: new Set(),
    feeScope,
    medicines: new Map(),
  };
  const textCell = (cell: RawCell | undefined): string | null => {
    if (typeof cell === 'string') return cell.trim();
    if (typeof cell === 'number' && Number.isFinite(cell)) return String(cell);
    return null;
  };
  if (type === 'TESTS' || type === 'MEDICINES') {
    const codes = [
      ...new Set(sheet.rows.map((r) => textCell(r.cells.code)).filter((c): c is string => !!c)),
    ];
    if (type === 'MEDICINES') {
      const found = await tx.medicine.findMany({ where: { tenantId, code: { in: codes } } });
      for (const m of found) {
        ctx.medicines.set(m.code, {
          id: m.id,
          name: m.name,
          composition: m.composition,
          form: m.form,
          active: m.active,
        });
      }
    } else {
      const items = await tx.chargeItem.findMany({ where: { tenantId, code: { in: codes } } });
      const prices = items.length
        ? await tx.chargeItemPrice.findMany({
            where: { tenantId, chargeItemId: { in: items.map((i) => i.id) } },
            orderBy: { effectiveFrom: 'desc' },
            select: { chargeItemId: true, amountPaise: true, effectiveFrom: true },
          })
        : [];
      const latest = new Map<string, Latest>();
      for (const p of prices) {
        if (!latest.has(p.chargeItemId)) {
          latest.set(p.chargeItemId, {
            amountPaise: p.amountPaise,
            effectiveFrom: p.effectiveFrom,
          });
        }
      }
      for (const i of items) {
        ctx.tests.set(i.code, {
          id: i.id,
          kind: i.kind,
          name: i.name,
          active: i.active,
          latest: latest.get(i.id) ?? null,
        });
      }
    }
  } else {
    const codes = [
      ...new Set(
        sheet.rows.map((r) => textCell(r.cells.doctorCode)).filter((c): c is string => !!c),
      ),
    ];
    const doctors = await tx.doctorProfile.findMany({ where: { tenantId, code: { in: codes } } });
    for (const d of doctors) {
      ctx.doctors.set(d.code, { id: d.id, active: d.active });
    }
    const fees = doctors.length
      ? await tx.doctorFee.findMany({
          where: { tenantId, doctorProfileId: { in: doctors.map((d) => d.id) } },
          orderBy: { effectiveFrom: 'desc' },
          select: {
            doctorProfileId: true,
            branchId: true,
            visitType: true,
            amountPaise: true,
            effectiveFrom: true,
          },
        })
      : [];
    for (const f of fees) {
      const key = `${f.doctorProfileId}|${f.visitType}|${f.branchId ?? ''}`;
      if (!ctx.fees.has(key)) {
        ctx.fees.set(key, { amountPaise: f.amountPaise, effectiveFrom: f.effectiveFrom });
      }
      if (f.visitType === 'NEW') {
        ctx.newFeeDoctors.add(f.doctorProfileId);
      }
    }
    for (const b of await tx.branch.findMany({
      where: { tenantId },
      select: { id: true, code: true },
    })) {
      ctx.branches.set(b.code.toLowerCase(), { id: b.id });
    }
    const links = doctors.length
      ? await tx.userBranch.findMany({
          where: { tenantId, isActive: true, userId: { in: doctors.map((d) => d.userId) } },
          select: { userId: true, branchId: true },
        })
      : [];
    const profileOfUser = new Map(doctors.map((d) => [d.userId, d.id]));
    for (const l of links) {
      ctx.doctorBranches.add(`${profileOfUser.get(l.userId)}|${l.branchId}`);
    }
  }
  return ctx;
}
