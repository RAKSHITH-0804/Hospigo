import type { VitalsField, VitalsReadingPayload, VitalsReadingView } from './clinical-types';

/** What the nurse typed for one field: the value and (for a correction) the reason. */
export type VitalsDraft = { value: string; reason: string };

export type VitalsFieldProblem = 'INVALID' | 'REASON';

export type VitalsPlan = {
  /** Readings to send: only fields that are new or really changed. Empty when there is a problem. */
  readings: VitalsReadingPayload[];
  /** Per field code: the value cannot be used, or a changed value still needs its reason. */
  problems: Record<string, VitalsFieldProblem>;
  /** True when something can be sent (at least one change and no problem). */
  ok: boolean;
};

const NUMBER_TEXT = /^\d{1,8}(?:\.\d{1,2})?$/;
const TEXT_MAX = 200;

/** Same limits as the API; the API checks again. Blank means "not entered" (never an error). */
export function parseVitalsValue(
  field: Pick<VitalsField, 'valueKind'>,
  raw: string,
): number | string | null {
  const text = raw.trim();
  if (field.valueKind === 'NUMBER') {
    return NUMBER_TEXT.test(text) ? Number(text) : null;
  }
  return text.length > 0 && text.length <= TEXT_MAX ? text : null;
}

function sameValue(a: number | string, b: number | string): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.round(a * 100) === Math.round(b * 100);
  }
  return a === b;
}

/**
 * Turns what was typed into the readings to send. A blank box is skipped; a value equal to the
 * current reading is skipped (nothing to change); a different value for a field that already has
 * a reading is a CORRECTION and needs a reason. Nothing is sent while any field has a problem.
 */
export function planVitals(
  fields: VitalsField[],
  drafts: Record<string, VitalsDraft>,
  current: VitalsReadingView[],
): VitalsPlan {
  const currentByCode = new Map(current.map((c) => [c.code, c]));
  const readings: VitalsReadingPayload[] = [];
  const problems: Record<string, VitalsFieldProblem> = {};
  for (const field of fields) {
    const draft = drafts[field.code];
    if (!draft || draft.value.trim() === '') {
      continue;
    }
    const value = parseVitalsValue(field, draft.value);
    if (value === null) {
      problems[field.code] = 'INVALID';
      continue;
    }
    const existing = currentByCode.get(field.code);
    if (existing && sameValue(existing.value, value)) {
      continue;
    }
    if (existing) {
      const reason = draft.reason.trim();
      if (reason === '') {
        problems[field.code] = 'REASON';
        continue;
      }
      readings.push({ fieldCode: field.code, value, correctionReason: reason });
    } else {
      readings.push({ fieldCode: field.code, value });
    }
  }
  const hasProblem = Object.keys(problems).length > 0;
  return {
    readings: hasProblem ? [] : readings,
    problems,
    ok: !hasProblem && readings.length > 0,
  };
}

/** True when the typed value would CHANGE an existing reading (so a reason is needed). */
export function isCorrection(
  field: Pick<VitalsField, 'valueKind'>,
  rawValue: string,
  existing: Pick<VitalsReadingView, 'value'> | undefined,
): boolean {
  if (!existing) {
    return false;
  }
  const value = parseVitalsValue(field, rawValue);
  return value !== null && !sameValue(existing.value, value);
}
