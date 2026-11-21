import { removePicture, uploadPicture } from '@/lib/images/client';
import { IMAGE_ROUTES, doctorSignatureRoute } from '@/lib/images/types';
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

/** The signature or stamp picture: a doctor changes their own, an Admin one of their doctors. */
export const uploadMySignature = (file: File): Promise<PatientsApiResult<MyProfileResponse>> =>
  uploadPicture<MyProfileResponse>(IMAGE_ROUTES.mySignature, file);

export const removeMySignature = (): Promise<PatientsApiResult<MyProfileResponse>> =>
  removePicture<MyProfileResponse>(IMAGE_ROUTES.mySignatureRemove);

export const uploadDoctorSignature = (
  id: string,
  file: File,
): Promise<PatientsApiResult<DoctorProfile>> =>
  uploadPicture<DoctorProfile>(doctorSignatureRoute(id), file);

export const removeDoctorSignature = (id: string): Promise<PatientsApiResult<DoctorProfile>> =>
  removePicture<DoctorProfile>(`${doctorSignatureRoute(id)}/remove`);
