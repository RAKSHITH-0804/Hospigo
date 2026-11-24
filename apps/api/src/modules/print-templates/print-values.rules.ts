/**
 * Rules for the extra print values (Step 8c). A value is a named piece of PLAIN TEXT: no line breaks,
 * no angle brackets (so no HTML), no invisible direction or zero-width characters (a printed text
 * must read as it was typed), nothing is ever evaluated (so no formulas and no scripts). The
 * same rules are repeated in the database (check constraints).
 */
export const PRINT_VALUE_LIMITS = {
  keyMax: 30,
  labelMax: 60,
  valueMax: 200,
  /** Values one scope (the hospital, or one branch) may hold. */
  perScopeMax: 30,
} as const;

export const PRINT_VALUE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;

/** Prefix that tells a template value of this kind from the built-in values (like patientName). */
export const PRINT_VALUE_FIELD_PREFIX = 'value.';

/** The template field name of an extra value key. */
export const printValueField = (key: string): string => `${PRINT_VALUE_FIELD_PREFIX}${key}`;

/** True for a template field name that points at an extra value (the value itself is looked up when printing). */
export function isPrintValueField(field: string): boolean {
  return (
    field.startsWith(PRINT_VALUE_FIELD_PREFIX) &&
    PRINT_VALUE_KEY_PATTERN.test(field.slice(PRINT_VALUE_FIELD_PREFIX.length))
  );
}

export class PrintValueRuleError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// eslint-disable-next-line no-control-regex
const NOT_PLAIN = /[\u0000-\u001f\u007f-\u009f<>\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

function plainText(field: string, raw: unknown, max: number): string {
  if (typeof raw !== 'string') {
    throw new PrintValueRuleError(field, 'REQUIRED');
  }
  const text = raw.trim();
  if (text.length === 0) {
    throw new PrintValueRuleError(field, 'REQUIRED');
  }
  if (text.length > max) {
    throw new PrintValueRuleError(field, 'TOO_LONG');
  }
  if (NOT_PLAIN.test(text)) {
    throw new PrintValueRuleError(field, 'NOT_PLAIN_TEXT');
  }
  return text;
}

function only(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new PrintValueRuleError(key, 'UNKNOWN_FIELD');
    }
  }
}

export type PrintValueCreate = { key: string; label: string; value: string };
export type PrintValuePatch = { label?: string; value?: string; active?: boolean };

export function parsePrintValueCreate(body: unknown): PrintValueCreate {
  if (!isObject(body)) {
    throw new PrintValueRuleError('key', 'REQUIRED');
  }
  only(body, ['key', 'label', 'value']);
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (key === '') {
    throw new PrintValueRuleError('key', 'REQUIRED');
  }
  if (!PRINT_VALUE_KEY_PATTERN.test(key)) {
    throw new PrintValueRuleError('key', 'KEY_INVALID');
  }
  return {
    key,
    label: plainText('label', body.label, PRINT_VALUE_LIMITS.labelMax),
    value: plainText('value', body.value, PRINT_VALUE_LIMITS.valueMax),
  };
}

export function parsePrintValuePatch(body: unknown): PrintValuePatch {
  if (!isObject(body)) {
    throw new PrintValueRuleError('label', 'REQUIRED');
  }
  only(body, ['label', 'value', 'active']);
  const out: PrintValuePatch = {};
  if (body.label !== undefined) {
    out.label = plainText('label', body.label, PRINT_VALUE_LIMITS.labelMax);
  }
  if (body.value !== undefined) {
    out.value = plainText('value', body.value, PRINT_VALUE_LIMITS.valueMax);
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      throw new PrintValueRuleError('active', 'NOT_A_BOOLEAN');
    }
    out.active = body.active;
  }
  if (Object.keys(out).length === 0) {
    throw new PrintValueRuleError('label', 'NOTHING_TO_CHANGE');
  }
  return out;
}
