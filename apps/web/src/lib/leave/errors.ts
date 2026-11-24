import { staffCopy } from '@/config/staff-copy';
import { availabilityErrorMessage } from '@/lib/availability/errors';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.leave.errors;

/** The calm sentence for a refused leave request action. Never shows upstream text. */
export function leaveErrorMessage(error: PatientsApiError): string {
  if (error.code === 'LEAVE_REQUEST_NOT_FOUND') {
    return copy.notFound;
  }
  if (error.code === 'LEAVE_REQUEST_CONFLICT') {
    return (error.reason ? copy.conflicts[error.reason] : undefined) ?? copy.conflictFallback;
  }
  if (error.code === 'SELF_APPROVAL_FORBIDDEN') {
    return copy.self;
  }
  if (error.code === 'DOCTOR_PROFILE_REQUIRED') {
    return copy.noProfile;
  }
  if (error.code === 'AVAILABILITY_INVALID') {
    return availabilityErrorMessage(error);
  }
  return errorMessageFor(error.code);
}
