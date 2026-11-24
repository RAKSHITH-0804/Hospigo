import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import {
  MASTERS_ROUTES,
  type PaymentModeRow,
  type PaymentModesResponse,
  type SeriesKind,
  type SeriesResponse,
  type SeriesRow,
  type VitalsFieldRow,
  type VitalsFieldsResponse,
} from './types';

/** Browser calls to the Next route handlers of the masters screens. Tokens never reach the browser. */

export function listPaymentModes(): Promise<PatientsApiResult<PaymentModesResponse>> {
  return patientsApi<PaymentModesResponse>(MASTERS_ROUTES.paymentModes);
}

export function addPaymentMode(body: {
  code: string;
  name: string;
  requiresReference: boolean;
}): Promise<PatientsApiResult<PaymentModeRow>> {
  return patientsApi<PaymentModeRow>(MASTERS_ROUTES.paymentModes, { method: 'POST', body });
}

export function changePaymentMode(
  id: string,
  body: { name?: string; requiresReference?: boolean; active?: boolean },
): Promise<PatientsApiResult<PaymentModeRow>> {
  return patientsApi<PaymentModeRow>(`${MASTERS_ROUTES.paymentModes}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
}

export function listVitalsFields(): Promise<PatientsApiResult<VitalsFieldsResponse>> {
  return patientsApi<VitalsFieldsResponse>(MASTERS_ROUTES.vitalsFields);
}

export function addVitalsField(body: {
  code: string;
  name: string;
  unit: string;
  valueKind: 'NUMBER' | 'TEXT';
  warnMin: number | null;
  warnMax: number | null;
}): Promise<PatientsApiResult<VitalsFieldRow>> {
  return patientsApi<VitalsFieldRow>(MASTERS_ROUTES.vitalsFields, { method: 'POST', body });
}

export function changeVitalsField(
  id: string,
  body: {
    name?: string;
    unit?: string;
    warnMin?: number | null;
    warnMax?: number | null;
    active?: boolean;
  },
): Promise<PatientsApiResult<VitalsFieldRow>> {
  return patientsApi<VitalsFieldRow>(`${MASTERS_ROUTES.vitalsFields}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
}

export function reorderVitalsFields(
  ids: string[],
): Promise<PatientsApiResult<VitalsFieldsResponse>> {
  return patientsApi<VitalsFieldsResponse>(`${MASTERS_ROUTES.vitalsFields}/reorder`, {
    method: 'POST',
    body: { ids },
  });
}

export function listNumberSeries(): Promise<PatientsApiResult<SeriesResponse>> {
  return patientsApi<SeriesResponse>(MASTERS_ROUTES.numberSeries);
}

export function changeNumberSeries(
  series: SeriesKind,
  body: {
    prefix?: string;
    separator?: string;
    fyStyle?: 'SHORT' | 'LONG';
    width?: number;
    resetRule?: 'NEVER' | 'FINANCIAL_YEAR';
    fyStartMonth?: number;
  },
): Promise<PatientsApiResult<SeriesRow>> {
  return patientsApi<SeriesRow>(`${MASTERS_ROUTES.numberSeries}/${series}`, {
    method: 'PUT',
    body,
  });
}

export function raiseStartNumber(
  series: SeriesKind,
  body: { startNumber: number; reason: string },
): Promise<PatientsApiResult<SeriesRow>> {
  return patientsApi<SeriesRow>(`${MASTERS_ROUTES.numberSeries}/${series}/start-number`, {
    method: 'PUT',
    body,
  });
}
