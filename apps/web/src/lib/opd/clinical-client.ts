import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import type {
  CompleteResponse,
  ConsultationResponse,
  MedicineSearchResponse,
  NoteBody,
  PrescriptionItemPayload,
  QueueResponse,
  StartResponse,
  VitalsReadingPayload,
  VitalsResponse,
} from './clinical-types';

/** Next route handlers that proxy the clinical API. Browsers never see tokens. */
export const OPD_QUEUE_API = '/api/staff/opd/queue';
export const OPD_MEDICINES_API = '/api/staff/opd/medicines';

const visitApi = (visitId: string, tail = ''): string =>
  `/api/staff/opd/visits/${encodeURIComponent(visitId)}${tail}`;

export function consultPath(visitId: string): string {
  return `/app/opd/visits/${encodeURIComponent(visitId)}/consult`;
}

export function vitalsPath(visitId: string): string {
  return `/app/opd/visits/${encodeURIComponent(visitId)}/vitals`;
}

export function loadQueue(
  signal?: AbortSignal,
  doctorProfileId?: string,
): Promise<PatientsApiResult<QueueResponse>> {
  const query = doctorProfileId ? `?doctorProfileId=${encodeURIComponent(doctorProfileId)}` : '';
  return patientsApi<QueueResponse>(`${OPD_QUEUE_API}${query}`, { signal });
}

export function startConsultation(visitId: string): Promise<PatientsApiResult<StartResponse>> {
  return patientsApi<StartResponse>(visitApi(visitId, '/start'), { method: 'POST', body: {} });
}

export function saveNote(
  visitId: string,
  note: NoteBody,
): Promise<PatientsApiResult<ConsultationResponse>> {
  return patientsApi<ConsultationResponse>(visitApi(visitId, '/consultation'), {
    method: 'PUT',
    body: note,
  });
}

export function savePrescription(
  visitId: string,
  items: PrescriptionItemPayload[],
): Promise<PatientsApiResult<ConsultationResponse>> {
  return patientsApi<ConsultationResponse>(visitApi(visitId, '/prescription'), {
    method: 'PUT',
    body: { items },
  });
}

export function completeConsultation(
  visitId: string,
): Promise<PatientsApiResult<CompleteResponse>> {
  return patientsApi<CompleteResponse>(visitApi(visitId, '/complete'), {
    method: 'POST',
    body: {},
  });
}

export function addAddendum(
  visitId: string,
  body: { text: string; reason: string },
): Promise<PatientsApiResult<ConsultationResponse>> {
  return patientsApi<ConsultationResponse>(visitApi(visitId, '/consultation/addenda'), {
    method: 'POST',
    body,
  });
}

export function recordVitals(
  visitId: string,
  readings: VitalsReadingPayload[],
): Promise<PatientsApiResult<VitalsResponse>> {
  return patientsApi<VitalsResponse>(visitApi(visitId, '/vitals'), {
    method: 'POST',
    body: { readings },
  });
}

export function searchMedicines(
  q: string,
  limit: number,
  signal?: AbortSignal,
): Promise<PatientsApiResult<MedicineSearchResponse>> {
  return patientsApi<MedicineSearchResponse>(
    `${OPD_MEDICINES_API}?q=${encodeURIComponent(q)}&limit=${limit}`,
    { signal },
  );
}
