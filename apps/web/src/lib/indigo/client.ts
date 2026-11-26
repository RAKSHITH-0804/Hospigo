import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import type { IndigoEmployee, OnboardBody, OnboardResult } from './types';

const BASE = '/api/staff/indigo';

export const onboardHospital = (body: OnboardBody): Promise<PatientsApiResult<OnboardResult>> =>
  patientsApi<OnboardResult>(`${BASE}/hospitals`, { method: 'POST', body });

export const saveHospitalModules = (
  hospitalId: string,
  moduleCodes: string[],
): Promise<PatientsApiResult<{ moduleCodes: string[] }>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(hospitalId)}/modules`, {
    method: 'PUT',
    body: { moduleCodes },
  });

export const createEmployee = (body: {
  name: string;
  email: string;
}): Promise<
  PatientsApiResult<{ id: string; email: string; displayName: string; temporaryPassword: string }>
> => patientsApi(`${BASE}/employees`, { method: 'POST', body });

export const saveEmployeeHospitals = (
  id: string,
  hospitalIds: string[],
): Promise<PatientsApiResult<{ hospitalIds: string[] }>> =>
  patientsApi(`${BASE}/employees/${encodeURIComponent(id)}/hospitals`, {
    method: 'PUT',
    body: { hospitalIds },
  });

export const setEmployeeActive = (
  id: string,
  active: boolean,
): Promise<PatientsApiResult<{ id: string; isActive: boolean }>> =>
  patientsApi(
    `${BASE}/employees/${encodeURIComponent(id)}/${active ? 'reactivate' : 'deactivate'}`,
    {
      method: 'POST',
      body: {},
    },
  );

export type { IndigoEmployee };
