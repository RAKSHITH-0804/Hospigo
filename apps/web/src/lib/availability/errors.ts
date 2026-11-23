import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.availability.errors;

/** The calm sentence for a refused availability change. Never shows upstream text. */
export function availabilityErrorMessage(error: PatientsApiError): string {
  if (error.status === 404) {
    return copy.notFound;
  }
  if (error.status === 400 && error.code === 'AVAILABILITY_INVALID') {
    return (error.reason ? copy.reasons[error.reason] : undefined) ?? copy.fallback;
  }
  if (error.status === 400) {
    return copy.fallback;
  }
  return errorMessageFor(error.code);
}
