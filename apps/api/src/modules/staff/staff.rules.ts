import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { STAFF_CODE_LIMITS, STAFF_LIMITS } from './staff.config';

export const StaffReason = {
  REQUIRED: 'REQUIRED',
  INVALID: 'INVALID',
  TOO_LONG: 'TOO_LONG',
  TOO_MANY: 'TOO_MANY',
  DUPLICATE: 'DUPLICATE',
  NOT_ALLOWED: 'NOT_ALLOWED',
  UNKNOWN: 'UNKNOWN',
} as const;

export function refuse(field: string, reason: string): never {
  throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field, reason });
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

/** A short single-line text: trimmed, spaces tidied, no control characters. */
export function readText(value: unknown, field: string, max: number, required = true): string {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) {
      refuse(field, StaffReason.REQUIRED);
    }
    return '';
  }
  if (typeof value !== 'string' || hasControlCharacters(value)) {
    refuse(field, StaffReason.INVALID);
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > max) {
    refuse(field, StaffReason.TOO_LONG);
  }
  return text;
}

const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** An email address, lower case. This only checks the shape; a real person confirms it by the code or link. */
export function readEmail(value: unknown, field = 'email'): string {
  const text = readText(value, field, STAFF_LIMITS.emailMax).toLowerCase();
  if (text.includes(' ') || !EMAIL_PATTERN.test(text)) {
    refuse(field, StaffReason.INVALID);
  }
  return text;
}

const PHONE_PATTERN = /^[0-9+ ()-]{7,20}$/;

/** A phone number the person types as they like (digits, +, spaces, brackets, dash); empty clears it. */
export function readPhone(value: unknown, field = 'phone'): string | null {
  if (value === null || (typeof value === 'string' && !value.trim())) {
    return null;
  }
  const text = readText(value, field, STAFF_LIMITS.phoneMax);
  if (!PHONE_PATTERN.test(text)) {
    refuse(field, StaffReason.INVALID);
  }
  return text;
}

/** A list of ids (strings of the usual id characters), once each. */
export function readIds(value: unknown, field: string, max: number, min = 1): string[] {
  if (!Array.isArray(value) || value.length < min) {
    refuse(field, StaffReason.REQUIRED);
  }
  if (value.length > max) {
    refuse(field, StaffReason.TOO_MANY);
  }
  const out: string[] = [];
  for (const [index, id] of value.entries()) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      refuse(`${field}.${index}`, StaffReason.INVALID);
    }
    if (out.includes(id)) {
      refuse(field, StaffReason.DUPLICATE);
    }
    out.push(id);
  }
  return out;
}

export type AssignmentInput = { roleId: string; scope: 'BRANCH' | 'HOSPITAL' };

/** The roles of a person: each `{ roleId, scope? }` (scope BRANCH when left out), once per role. */
export function readAssignments(value: unknown, field = 'roles'): AssignmentInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    refuse(field, StaffReason.REQUIRED);
  }
  if (value.length > STAFF_LIMITS.maxRolesPerPerson) {
    refuse(field, StaffReason.TOO_MANY);
  }
  const out: AssignmentInput[] = [];
  for (const [index, raw] of value.entries()) {
    if (
      !isRecord(raw) ||
      typeof raw.roleId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(raw.roleId)
    ) {
      refuse(`${field}.${index}.roleId`, StaffReason.INVALID);
    }
    const scope = raw.scope ?? 'BRANCH';
    if (scope !== 'BRANCH' && scope !== 'HOSPITAL') {
      refuse(`${field}.${index}.scope`, StaffReason.INVALID);
    }
    if (out.some((a) => a.roleId === raw.roleId)) {
      refuse(field, StaffReason.DUPLICATE);
    }
    out.push({ roleId: raw.roleId, scope });
  }
  return out;
}

export type CodeFormatInput = { prefix: string; minWidth: number };

/** How the staff code is made: letters and digits as the prefix, and the least number of digits. */
export function readCodeFormat(body: unknown): CodeFormatInput {
  if (!isRecord(body)) {
    refuse('body', StaffReason.REQUIRED);
  }
  const prefix = body.prefix;
  if (typeof prefix !== 'string' || prefix.length === 0) {
    refuse('prefix', StaffReason.REQUIRED);
  }
  if (prefix.length > STAFF_CODE_LIMITS.prefixMax) {
    refuse('prefix', StaffReason.TOO_LONG);
  }
  if (!/^[A-Za-z0-9]+$/.test(prefix)) {
    refuse('prefix', StaffReason.INVALID);
  }
  const width = body.minWidth;
  if (
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < STAFF_CODE_LIMITS.minWidthMin ||
    width > STAFF_CODE_LIMITS.minWidthMax
  ) {
    refuse('minWidth', StaffReason.INVALID);
  }
  return { prefix: prefix.toUpperCase(), minWidth: width };
}

export function formatStaffCode(prefix: string, minWidth: number, n: number | bigint): string {
  return `${prefix}${String(n).padStart(minWidth, '0')}`;
}
