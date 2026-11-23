import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.prices.errors;

/** The calm sentence for a refused price change. Never shows upstream text. */
export function priceErrorMessage(error: PatientsApiError): string {
  if (error.status === 404 && error.code === 'PRICE_ITEM_NOT_FOUND') {
    return copy.notFound;
  }
  if (error.status === 400 && error.code === 'PRICE_INVALID') {
    return (error.reason ? copy.reasons[error.reason] : undefined) ?? copy.fallback;
  }
  if (error.status === 400) {
    return copy.fallback;
  }
  return errorMessageFor(error.code);
}
