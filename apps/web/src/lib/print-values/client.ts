import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import { PRINT_VALUE_ROUTES, type PrintValueRow, type PrintValuesManageResponse } from './types';

/** Browser calls to the Next route handlers for extra print values. Tokens never reach the browser. */

export const listPrintValues = (): Promise<PatientsApiResult<PrintValuesManageResponse>> =>
  patientsApi<PrintValuesManageResponse>(PRINT_VALUE_ROUTES.all);

export const addPrintValue = (
  body: { key: string; label: string; value: string },
  scope: 'branch' | 'hospital',
): Promise<PatientsApiResult<PrintValueRow>> =>
  patientsApi<PrintValueRow>(`${PRINT_VALUE_ROUTES.all}?scope=${scope}`, {
    method: 'POST',
    body,
  });

export const changePrintValue = (
  id: string,
  body: { label?: string; value?: string; active?: boolean },
): Promise<PatientsApiResult<PrintValueRow>> =>
  patientsApi<PrintValueRow>(`${PRINT_VALUE_ROUTES.all}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
