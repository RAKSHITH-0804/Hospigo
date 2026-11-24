import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.printValues.errors;

/** The calm sentence for a refused change of a print value. Never shows upstream text. */
export function printValueErrorMessage(error: PatientsApiError): string {
  if (error.code === 'PRINT_VALUE_NOT_FOUND') {
    return copy.notFound;
  }
  if (error.code === 'PRINT_VALUE_CONFLICT') {
    return (error.reason ? copy.conflicts[error.reason] : undefined) ?? copy.conflictFallback;
  }
  if (error.code === 'PRINT_VALUE_INVALID') {
    return (error.reason ? copy.reasons[error.reason] : undefined) ?? copy.fallback;
  }
  if (error.code === 'PRINT_SCOPE_FORBIDDEN') {
    return copy.scopeForbidden;
  }
  if (error.code === 'PRINT_SCOPE_INVALID' || error.status === 400) {
    return copy.fallback;
  }
  return errorMessageFor(error.code);
}
