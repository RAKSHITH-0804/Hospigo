import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import {
  DOCTOR_ROUTES,
  type DoctorProfile,
  type DoctorProfileBody,
  type MyProfileResponse,
} from './types';

/** Browser calls to the Next route handlers for doctor profiles. Tokens never reach the browser. */

export const saveMyProfile = (
  body: DoctorProfileBody,
): Promise<PatientsApiResult<MyProfileResponse>> =>
  patientsApi<MyProfileResponse>(DOCTOR_ROUTES.me, { method: 'PUT', body });

export const saveDoctorProfile = (
  id: string,
  body: DoctorProfileBody,
): Promise<PatientsApiResult<DoctorProfile>> =>
  patientsApi<DoctorProfile>(`${DOCTOR_ROUTES.one}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });
