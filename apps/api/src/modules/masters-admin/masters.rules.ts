import { MASTERS_CONFIG as C } from './masters.config';

/** A refusal with the field and a stable reason code (the web screen shows plain words for it). */
export class MasterRuleError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Only the listed keys may be present. */
export function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new MasterRuleError(key, 'UNKNOWN_FIELD');
    }
  }
}

/** Plain text: trimmed, not empty, within the limit, no control characters and no angle brackets (no markup). */
export function plainText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') {
    throw new MasterRuleError(field, 'REQUIRED');
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length === 0) {
    throw new MasterRuleError(field, 'REQUIRED');
  }
  if (text.length > max) {
    throw new MasterRuleError(field, 'TOO_LONG');
  }
  if (Array.from(text).some((ch) => ch.charCodeAt(0) < 32) || /[<>]/.test(text)) {
    throw new MasterRuleError(field, 'NOT_PLAIN_TEXT');
  }
  return text;
}

// ------------------------------------------------------------------------- payment modes

export type PaymentModeCreate = { code: string; name: string; requiresReference: boolean };
export type PaymentModePatch = { name?: string; requiresReference?: boolean; active?: boolean };

export function parsePaymentModeCreate(body: unknown): PaymentModeCreate {
  if (!isObject(body)) {
    throw new MasterRuleError('code', 'REQUIRED');
  }
  onlyKeys(body, ['code', 'name', 'requiresReference']);
  if (typeof body.code !== 'string') {
    throw new MasterRuleError('code', 'REQUIRED');
  }
  const code = body.code.trim().toUpperCase();
  if (!C.paymentModeCodePattern.test(code)) {
    throw new MasterRuleError('code', 'CODE_INVALID');
  }
  if (typeof body.requiresReference !== 'boolean') {
    throw new MasterRuleError('requiresReference', 'NOT_A_BOOLEAN');
  }
  return {
    code,
    name: plainText(body.name, 'name', C.paymentModeNameMax),
    requiresReference: body.requiresReference,
  };
}

export function parsePaymentModePatch(body: unknown): PaymentModePatch {
  if (!isObject(body)) {
    throw new MasterRuleError('name', 'NOTHING_TO_CHANGE');
  }
  onlyKeys(body, ['name', 'requiresReference', 'active']);
  const patch: PaymentModePatch = {};
  if (body.name !== undefined) {
    patch.name = plainText(body.name, 'name', C.paymentModeNameMax);
  }
  for (const key of ['requiresReference', 'active'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') {
        throw new MasterRuleError(key, 'NOT_A_BOOLEAN');
      }
      patch[key] = body[key] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new MasterRuleError('name', 'NOTHING_TO_CHANGE');
  }
  return patch;
}

// ---------------------------------------------------------------------------- vitals fields

export type VitalsCreate = {
  code: string;
  name: string;
  unit: string;
  valueKind: 'NUMBER' | 'TEXT';
  warnMin: number | null;
  warnMax: number | null;
};
export type VitalsPatch = {
  name?: string;
  unit?: string;
  warnMin?: number | null;
  warnMax?: number | null;
  active?: boolean;
};

/** A warning limit: null clears it, otherwise a number with at most 2 decimals inside the allowed range. */
function warnLimit(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MasterRuleError(field, 'NOT_A_NUMBER');
  }
  if (Math.abs(value) > C.warnLimitMax) {
    throw new MasterRuleError(field, 'OUT_OF_RANGE');
  }
  if (Math.round(value * 100) / 100 !== value) {
    throw new MasterRuleError(field, 'TOO_MANY_DECIMALS');
  }
  return value;
}

export function checkWarnPair(min: number | null, max: number | null): void {
  if (min !== null && max !== null && min >= max) {
    throw new MasterRuleError('warnMax', 'MAX_NOT_ABOVE_MIN');
  }
}

export function parseVitalsCreate(body: unknown): VitalsCreate {
  if (!isObject(body)) {
    throw new MasterRuleError('code', 'REQUIRED');
  }
  onlyKeys(body, ['code', 'name', 'unit', 'valueKind', 'warnMin', 'warnMax']);
  if (typeof body.code !== 'string' || !C.vitalsCodePattern.test(body.code.trim().toLowerCase())) {
    throw new MasterRuleError('code', 'CODE_INVALID');
  }
  if (body.valueKind !== 'NUMBER' && body.valueKind !== 'TEXT') {
    throw new MasterRuleError('valueKind', 'KIND_INVALID');
  }
  const warnMin = body.warnMin === undefined ? null : warnLimit(body.warnMin, 'warnMin');
  const warnMax = body.warnMax === undefined ? null : warnLimit(body.warnMax, 'warnMax');
  if (body.valueKind === 'TEXT' && (warnMin !== null || warnMax !== null)) {
    throw new MasterRuleError('warnMin', 'WARN_NEEDS_NUMBER');
  }
  checkWarnPair(warnMin, warnMax);
  return {
    code: body.code.trim().toLowerCase(),
    name: plainText(body.name, 'name', C.vitalsNameMax),
    unit: plainText(body.unit, 'unit', C.vitalsUnitMax),
    valueKind: body.valueKind,
    warnMin,
    warnMax,
  };
}

export function parseVitalsPatch(body: unknown): VitalsPatch {
  if (!isObject(body)) {
    throw new MasterRuleError('name', 'NOTHING_TO_CHANGE');
  }
  onlyKeys(body, ['name', 'unit', 'warnMin', 'warnMax', 'active']);
  const patch: VitalsPatch = {};
  if (body.name !== undefined) {
    patch.name = plainText(body.name, 'name', C.vitalsNameMax);
  }
  if (body.unit !== undefined) {
    patch.unit = plainText(body.unit, 'unit', C.vitalsUnitMax);
  }
  if (body.warnMin !== undefined) {
    patch.warnMin = warnLimit(body.warnMin, 'warnMin');
  }
  if (body.warnMax !== undefined) {
    patch.warnMax = warnLimit(body.warnMax, 'warnMax');
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      throw new MasterRuleError('active', 'NOT_A_BOOLEAN');
    }
    patch.active = body.active;
  }
  if (Object.keys(patch).length === 0) {
    throw new MasterRuleError('name', 'NOTHING_TO_CHANGE');
  }
  return patch;
}

export function parseReorder(body: unknown): string[] {
  if (!isObject(body)) {
    throw new MasterRuleError('ids', 'REQUIRED');
  }
  onlyKeys(body, ['ids']);
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > C.vitalsMax ||
    ids.some((i) => typeof i !== 'string' || !C.idPattern.test(i))
  ) {
    throw new MasterRuleError('ids', 'IDS_INVALID');
  }
  if (new Set(ids).size !== ids.length) {
    throw new MasterRuleError('ids', 'IDS_DUPLICATE');
  }
  return ids as string[];
}
