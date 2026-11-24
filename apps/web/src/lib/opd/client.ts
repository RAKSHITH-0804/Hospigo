import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import type {
  OpdDoctorsResponse,
  PaymentLinePayload,
  VisitPreview,
  VisitType,
  VisitView,
} from './types';

/** Next route handlers that proxy the OPD API. Browsers never see tokens. */
export const OPD_DOCTORS_API = '/api/staff/opd/doctors';
export const OPD_PREVIEW_API = '/api/staff/opd/visits/preview';
export const OPD_VISITS_API = '/api/staff/opd/visits';

export function newVisitPath(patientId: string): string {
  return `/app/patients/${encodeURIComponent(patientId)}/visits/new`;
}

export function visitReceiptPath(visitId: string): string {
  return `/app/opd/visits/${encodeURIComponent(visitId)}/receipt`;
}

/** Message for an OPD error code; anything unknown falls back to the common wording. */
export function opdErrorMessageFor(code: string): string {
  const specific = (staffCopy.opd.errors as Record<string, string>)[code];
  return specific ?? errorMessageFor(code);
}

/**
 * One key per "Take cash" attempt. The caller keeps it while the same choices are retried
 * (so a double click or a retry after a network error can never bill twice) and asks for a
 * new one when the choices change.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Very old browsers only: still unique enough for a per-click key.
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export type VisitChoice = { patientId: string; doctorProfileId: string; visitType: VisitType };

export function loadDoctors(): Promise<PatientsApiResult<OpdDoctorsResponse>> {
  return patientsApi<OpdDoctorsResponse>(OPD_DOCTORS_API);
}

export function previewVisit(
  choice: VisitChoice,
  signal?: AbortSignal,
): Promise<PatientsApiResult<VisitPreview>> {
  return patientsApi<VisitPreview>(OPD_PREVIEW_API, { method: 'POST', body: choice, signal });
}

export function createVisit(
  choice: VisitChoice & {
    idempotencyKey: string;
    expectedTotalPaise: number;
    /** Left out for a free visit (nothing to pay). */
    payments?: PaymentLinePayload[];
  },
): Promise<PatientsApiResult<VisitView>> {
  return patientsApi<VisitView>(OPD_VISITS_API, { method: 'POST', body: choice });
}

/** One visit of the active branch (with its bill when the caller may read money). */
export function loadVisit(visitId: string): Promise<PatientsApiResult<VisitView>> {
  return patientsApi<VisitView>(`${OPD_VISITS_API}/${encodeURIComponent(visitId)}`);
}
