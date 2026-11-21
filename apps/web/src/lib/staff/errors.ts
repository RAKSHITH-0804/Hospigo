import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';
import { settingsErrorMessage } from '@/lib/settings/errors';

const copy = staffCopy.staffAdmin.errors;

/**
 * The calm sentence for a refused staff, role or account change. Conflicts and code problems get
 * their own wording; everything else is the usual "Cannot save: <field> <reason>" sentence. Upstream
 * text is never shown.
 */
export function staffErrorMessage(error: PatientsApiError): string {
  if (error.status === 409 && error.code === 'STAFF_CONFLICT') {
    return (error.reason && copy.conflicts[error.reason]) || copy.conflictFallback;
  }
  if (error.status === 429 && error.code === 'RATE_LIMITED') {
    return copy.rateLimited.replace('{seconds}', String(error.retryAfterSec ?? 0));
  }
  if (error.status === 400 && error.code === 'OTP_INVALID') {
    return (error.reason && copy.codes[error.reason]) || copy.codeFallback;
  }
  if (error.status === 400 && error.code === 'SETTINGS_INVALID') {
    return settingsErrorMessage(error);
  }
  if (error.status === 404 && error.code === 'SETTINGS_NOT_FOUND') {
    return settingsErrorMessage(error);
  }
  return errorMessageFor(error.code);
}
