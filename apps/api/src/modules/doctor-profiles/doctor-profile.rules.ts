import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';

/** Limits of the doctor profile fields (one place, no magic numbers). They match the database check. */
export const DOCTOR_PROFILE_LIMITS = {
  printedName: 80,
  qualifications: 150,
  speciality: 80,
  registrationNo: 40,
  department: 100,
} as const;

export type DoctorProfileField = keyof typeof DOCTOR_PROFILE_LIMITS;
const FIELDS = Object.keys(DOCTOR_PROFILE_LIMITS) as DoctorProfileField[];

/** Letters, digits, spaces and . / ( ) - , only: a registration number is copied from a certificate. */
const REGISTRATION_PATTERN = /^[A-Za-z0-9 ./(),-]+$/;

export const DoctorReason = {
  REQUIRED: 'REQUIRED',
  INVALID: 'INVALID',
  TOO_LONG: 'TOO_LONG',
  NOT_ALLOWED: 'NOT_ALLOWED',
} as const;

function refuse(field: string, reason: string): never {
  throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field, reason });
}

function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

export type DoctorProfileInput = Partial<Record<DoctorProfileField, string | null>>;

/**
 * Reads the body of "save the doctor profile". Only the fields that are present change; an empty
 * text (or null) clears a field. `allowDepartment` is false for a doctor editing their own profile
 * (the department decides the reports, so only an Admin changes it). Fields not on the list are
 * ignored. Every refusal names the field and the reason (`400 SETTINGS_INVALID`).
 */
export function parseDoctorProfile(
  body: unknown,
  options: { allowDepartment: boolean },
): DoctorProfileInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    refuse('body', DoctorReason.REQUIRED);
  }
  const input = body as Record<string, unknown>;
  const out: DoctorProfileInput = {};
  for (const field of FIELDS) {
    const raw = input[field];
    if (raw === undefined) {
      continue;
    }
    if (field === 'department' && !options.allowDepartment) {
      refuse(field, DoctorReason.NOT_ALLOWED);
    }
    if (raw === null) {
      out[field] = null;
      continue;
    }
    if (typeof raw !== 'string' || hasControlCharacters(raw)) {
      refuse(field, DoctorReason.INVALID);
    }
    const text = raw.trim().replace(/\s+/g, ' ');
    if (text.length === 0) {
      out[field] = null;
      continue;
    }
    if (text.length > DOCTOR_PROFILE_LIMITS[field]) {
      refuse(field, DoctorReason.TOO_LONG);
    }
    if (field === 'registrationNo' && !REGISTRATION_PATTERN.test(text)) {
      refuse(field, DoctorReason.INVALID);
    }
    out[field] = text;
  }
  if (Object.keys(out).length === 0) {
    refuse('body', DoctorReason.REQUIRED);
  }
  return out;
}
