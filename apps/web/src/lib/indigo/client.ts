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

export const saveEmployeePermissions = (
  id: string,
  permissions: string[],
): Promise<PatientsApiResult<{ permissions: string[] }>> =>
  patientsApi(`${BASE}/employees/${encodeURIComponent(id)}/permissions`, {
    method: 'PUT',
    body: { permissions },
  });

export const createSuperAdmin = (
  hospitalId: string,
  body: { name: string; email: string },
): Promise<PatientsApiResult<{ email: string; temporaryPassword: string }>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(hospitalId)}/super-admins`, {
    method: 'POST',
    body,
  });

export const resetSuperAdmin = (
  hospitalId: string,
  userId: string,
): Promise<PatientsApiResult<{ temporaryPassword: string }>> =>
  patientsApi(
    `${BASE}/hospitals/${encodeURIComponent(hospitalId)}/super-admins/${encodeURIComponent(userId)}/reset`,
    { method: 'POST', body: {} },
  );

export const activateDesign = (
  hospitalId: string,
  body: { templateId: string; branchId?: string },
): Promise<PatientsApiResult<{ docType: string; scope: string }>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(hospitalId)}/print-design`, {
    method: 'PUT',
    body,
  });

export const setHospitalLogo = (
  hospitalId: string,
  logoId: string,
): Promise<PatientsApiResult<{ ok: true }>> =>
  patientsApi(`${BASE}/hospitals/${encodeURIComponent(hospitalId)}/logo`, {
    method: 'PUT',
    body: { logoId },
  });

export type { IndigoEmployee };
