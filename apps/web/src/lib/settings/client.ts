import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import { SETTINGS_ROUTES } from './paths';
import type {
  BuiltinField,
  CustomDataType,
  CustomField,
  FieldSection,
  OpdRules,
  UhidFormat,
  UhidFormatResponse,
} from './types';

/** Browser calls to the Next route handlers of the settings screens. Tokens never reach the browser. */

export const saveOpdRules = (
  body: Partial<Pick<OpdRules, 'followUpFreeDays' | 'repeatVisitFreeHours'>>,
): Promise<PatientsApiResult<OpdRules>> =>
  patientsApi<OpdRules>(SETTINGS_ROUTES.opdRules, { method: 'PUT', body });

export const saveBuiltinField = (
  key: string,
  body: { isEnabled?: boolean; isRequired?: boolean },
): Promise<PatientsApiResult<BuiltinField>> =>
  patientsApi<BuiltinField>(`${SETTINGS_ROUTES.patientFields}/builtin/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body,
  });

export type NewCustomField = {
  label: string;
  dataType: CustomDataType;
  section: FieldSection;
  isRequired: boolean;
  options?: string[];
};

export const createCustomField = (body: NewCustomField): Promise<PatientsApiResult<CustomField>> =>
  patientsApi<CustomField>(`${SETTINGS_ROUTES.patientFields}/custom`, { method: 'POST', body });

export const updateCustomField = (
  id: string,
  body: { label?: string; section?: FieldSection; isEnabled?: boolean; isRequired?: boolean },
): Promise<PatientsApiResult<CustomField>> =>
  patientsApi<CustomField>(`${SETTINGS_ROUTES.patientFields}/custom/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });

export const saveCustomOptions = (
  id: string,
  options: Array<{ id?: string; label: string; isActive: boolean }>,
): Promise<PatientsApiResult<CustomField>> =>
  patientsApi<CustomField>(
    `${SETTINGS_ROUTES.patientFields}/custom/${encodeURIComponent(id)}/options`,
    { method: 'PUT', body: { options } },
  );

export const saveUhidFormat = (body: UhidFormat): Promise<PatientsApiResult<UhidFormatResponse>> =>
  patientsApi<UhidFormatResponse>(SETTINGS_ROUTES.uhidFormat, { method: 'POST', body });
