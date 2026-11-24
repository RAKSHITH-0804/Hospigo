import { opdWebConfig } from '@/config/opd';
import { PATIENT_PHONE_DISPLAY_GROUPS, patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';

const { form } = staffCopy.patients;

/** Placeholder for a missing value (same glyph staffCopy uses elsewhere). */
export const EMPTY_VALUE = '—';

/** Map known gender codes; unknown non-empty codes show as stored. */
export function genderLabel(code: string | null | undefined): string {
  switch (code) {
    case form.genderMaleValue:
      return form.genderMale;
    case form.genderFemaleValue:
      return form.genderFemale;
    case form.genderOtherValue:
      return form.genderOther;
    default: {
      const raw = code?.trim();
      return raw ? raw : EMPTY_VALUE;
    }
  }
}

export function ageLabel(ageYears: number | null | undefined): string {
  return ageYears === null || ageYears === undefined ? EMPTY_VALUE : String(ageYears);
}

export function textOrEmpty(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY_VALUE;
}

export function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : EMPTY_VALUE;
}

/** Format an ISO timestamp for the patients list (fixed locale and hospital time zone). */
export function formatRegisteredOn(
  iso: string | null | undefined,
  locale: string = patientsWebConfig.dateLocale,
  timeZone: string = opdWebConfig.reportTimeZone,
): string {
  if (!iso) {
    return EMPTY_VALUE;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/**
 * Format a calendar date (date of birth, custom date field) with the same look as the
 * table dates. Date-only values are stored as UTC midnight, so UTC is used to avoid
 * shifting the day in other time zones.
 */
export function formatDateOnly(
  iso: string | null | undefined,
  locale: string = patientsWebConfig.dateLocale,
): string {
  if (!iso) {
    return EMPTY_VALUE;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Digits only, capped. Used for phone / pincode / age typing and paste. */
export function digitsOnly(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLength);
}

/**
 * Display phone as "+91 70000 00039" when it matches configured prefix + groups;
 * otherwise show as stored.
 */
export function formatPhoneDisplay(
  stored: string | null | undefined,
  prefix: string = patientsWebConfig.phoneCountryCodePrefix,
  nationalLength: number = patientsWebConfig.phoneNationalLength,
  groups: readonly number[] = PATIENT_PHONE_DISPLAY_GROUPS,
): string {
  if (!stored?.trim()) {
    return EMPTY_VALUE;
  }
  const raw = stored.trim();
  const digits = raw.replace(/\D/g, '');
  const prefixDigits = prefix.replace(/\D/g, '');
  if (!digits.startsWith(prefixDigits) || digits.length !== prefixDigits.length + nationalLength) {
    return raw;
  }
  const national = digits.slice(prefixDigits.length);
  const groupSum = groups.reduce((a, b) => a + b, 0);
  if (groupSum !== nationalLength) {
    return `${prefix} ${national}`;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const size of groups) {
    parts.push(national.slice(cursor, cursor + size));
    cursor += size;
  }
  return `${prefix} ${parts.join(' ')}`;
}

/**
 * National 10-digit mobile from stored E.164 (+91…) or raw input.
 * Returns up to phoneNationalLength digits for the form input.
 */
export function nationalPhoneDigits(
  stored: string,
  nationalLength: number = patientsWebConfig.phoneNationalLength,
): string {
  const digits = stored.replace(/\D/g, '');
  if (digits.length >= nationalLength + 2 && digits.startsWith('91')) {
    return digits.slice(2, 2 + nationalLength);
  }
  if (digits.length > nationalLength) {
    return digits.slice(-nationalLength);
  }
  return digits.slice(0, nationalLength);
}

/** Only letters, digits, spaces, dots and dashes survive; anything else falls back. */
export function safePaperSize(size: string, fallback: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 .-]*$/.test(size.trim()) ? size.trim() : fallback;
}

/** A CSS length such as 0, 5mm, 0.5cm or 1in; anything else falls back. */
export function safePageMargin(margin: string, fallback: string): string {
  return /^\d+(\.\d+)?(mm|cm|in|pt|px)?$/.test(margin.trim()) ? margin.trim() : fallback;
}

/**
 * @page rule text. CSS variables are unreliable inside @page, so the values are inlined.
 * A margin of 0 stops the browser from printing its own date / URL header and footer.
 */
export function slipPageRule(
  size: string,
  margin: string = patientsWebConfig.slipPageMargin,
): string {
  return `@page { size: ${safePaperSize(size, 'A4')}; margin: ${safePageMargin(margin, '0')}; }`;
}
