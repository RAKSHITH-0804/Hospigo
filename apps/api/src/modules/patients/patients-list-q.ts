import { Prisma } from '../../generated/prisma';
import { PATIENT_PHONE_NATIONAL_LENGTH } from './patients.config';

/** Escape `\`, `%`, and `_` so LIKE treats them as literals (use with ESCAPE '\'). */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function countDigits(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/**
 * Digits used for phone-prefix matching under `q`:
 * strip spaces/dashes; if the result starts with `+`, drop `+` and a following `91`;
 * then keep digits only.
 */
export function extractQPhoneDigits(q: string): string {
  let s = q.replace(/[\s-]/g, '');
  if (s.startsWith('+')) {
    s = s.slice(1);
    if (s.startsWith('91')) {
      s = s.slice(2);
    }
  }
  return s.replace(/\D/g, '');
}

export type ListQMatchPlan = {
  namePrefixPat: string | null;
  nameWordPat: string | null;
  uhidPat: string | null;
  phonePat: string | null;
};

export function buildListQMatchPlan(
  q: string,
  limits: {
    minNameLength: number;
    minUhidLength: number;
    minPhoneDigits: number;
  },
): ListQMatchPlan | null {
  const canName = q.length >= limits.minNameLength;
  const canUhid = q.length >= limits.minUhidLength;
  const canPhone = countDigits(q) >= limits.minPhoneDigits;
  if (!canName && !canUhid && !canPhone) {
    return null;
  }

  const lower = q.toLowerCase();
  const escaped = escapeLikePattern(lower);
  const namePrefixPat = canName ? `${escaped}%` : null;
  const nameWordPat = canName ? `% ${escaped}%` : null;
  const uhidPat = canUhid ? `${escaped}%` : null;

  let phonePat: string | null = null;
  if (canPhone) {
    const digits = extractQPhoneDigits(q);
    if (digits.length > 0) {
      phonePat = `${escapeLikePattern(digits)}%`;
    }
  }

  if (!namePrefixPat && !uhidPat && !phonePat) {
    return null;
  }

  return { namePrefixPat, nameWordPat, uhidPat, phonePat };
}

/** Parameterised OR of enabled q match arms; TRUE when no plan (caller should not pass null). */
export function listQWhereSql(plan: ListQMatchPlan): Prisma.Sql {
  const arms: Prisma.Sql[] = [];
  if (plan.namePrefixPat !== null && plan.nameWordPat !== null) {
    arms.push(
      Prisma.sql`(lower(p.name) LIKE ${plan.namePrefixPat} ESCAPE '\\' OR lower(p.name) LIKE ${plan.nameWordPat} ESCAPE '\\')`,
    );
  }
  if (plan.uhidPat !== null) {
    arms.push(Prisma.sql`lower(p.uhid) LIKE ${plan.uhidPat} ESCAPE '\\'`);
  }
  if (plan.phonePat !== null) {
    arms.push(
      Prisma.sql`right(p.phone, ${PATIENT_PHONE_NATIONAL_LENGTH}) LIKE ${plan.phonePat} ESCAPE '\\'`,
    );
  }
  if (arms.length === 0) {
    return Prisma.sql`FALSE`;
  }
  return Prisma.join(arms, ' OR ');
}
