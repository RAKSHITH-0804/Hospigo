import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.masters.errors;

/** The calm sentence for a refused change of a master list. Never shows upstream text. */
export function masterErrorMessage(error: PatientsApiError): string {
  if (error.status === 404 && error.code === 'MASTER_NOT_FOUND') {
    return copy.notFound;
  }
  if (error.code === 'MASTER_INVALID') {
    return (error.reason ? copy.reasons[error.reason] : undefined) ?? copy.fallback;
  }
  if (error.code === 'MASTER_CONFLICT') {
    return (error.reason ? copy.conflicts[error.reason] : undefined) ?? copy.conflictFallback;
  }
  if (error.status === 400) {
    return copy.fallback;
  }
  return errorMessageFor(error.code);
}
