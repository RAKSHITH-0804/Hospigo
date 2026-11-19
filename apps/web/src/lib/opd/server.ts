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

// Steps 5a-2 / 5a-3 (queue, consultation, vitals).
export const API_OPD_QUEUE = '/opd/queue';
export const API_OPD_VITALS_FIELDS = '/opd/vitals-fields';
export const API_OPD_MEDICINES = '/opd/medicines';

export function apiConsultationPath(visitId: string): string {
  return `${apiVisitPath(visitId)}/consultation`;
}

export function apiVisitVitalsPath(visitId: string): string {
  return `${apiVisitPath(visitId)}/vitals`;
}

// Step 6b (tests and refunds).
export const API_OPD_PENDING_TESTS = '/opd/investigations/pending';
export const API_OPD_REFUND_REQUESTS = '/opd/refund-requests';

export function apiVisitTestsPath(visitId: string): string {
  return `${apiVisitPath(visitId)}/investigations`;
}
