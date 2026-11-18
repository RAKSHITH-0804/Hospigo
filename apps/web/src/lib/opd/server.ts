/** API paths for first-paint fetches made on the SERVER (the API origin is added by callStaffApi). */
export const API_OPD_DOCTORS = '/opd/doctors';
export const API_OPD_VISITS = '/opd/visits';
export const API_OPD_PAYMENT_MODES = '/opd/payment-modes';

export function apiPatientVisitsPath(patientId: string): string {
  return `/patients/${encodeURIComponent(patientId)}/visits`;
}

export function apiVisitPath(visitId: string): string {
  return `${API_OPD_VISITS}/${encodeURIComponent(visitId)}`;
}
