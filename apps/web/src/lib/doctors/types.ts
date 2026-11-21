/** What the doctor profile API answers (Step 7c). The API checks every value; these are only the shapes. */

export type DoctorProfile = {
  id: string;
  code: string;
  /** The login name. */
  name: string;
  printedName: string | null;
  /** What prints: the printed name, or the login name when that is empty. */
  printName: string;
  department: string | null;
  qualifications: string | null;
  speciality: string | null;
  registrationNo: string | null;
  active: boolean;
  /** Names of the branches the doctor works in. */
  branches: string[];
  /** Details a prescription needs that are still empty. */
  missing: Array<'qualifications' | 'speciality' | 'registrationNo'>;
};

export type DoctorLimits = {
  printedName: number;
  qualifications: number;
  speciality: number;
  registrationNo: number;
  department: number;
};

/** The answer of "my profile": the profile plus the limits of its fields. */
export type MyProfileResponse = DoctorProfile & { limits: DoctorLimits };

export type DoctorsListResponse = {
  items: DoctorProfile[];
  limits: DoctorLimits;
  canWrite: boolean;
};

/** The doctor details of a consultation (a completed note: the copy taken at completion). */
export type DoctorDetails = {
  name: string;
  printedName: string | null;
  printName: string;
  department: string | null;
  qualifications: string | null;
  speciality: string | null;
  registrationNo: string | null;
  fromCompletedCopy: boolean;
};

/** The fields a doctor or an Admin may change (empty text clears a field). */
export type DoctorProfileBody = {
  printedName?: string | null;
  qualifications?: string | null;
  speciality?: string | null;
  registrationNo?: string | null;
  department?: string | null;
};

/** API paths (server side) and the Next route handlers that proxy them (browser side). */
export const API_DOCTOR_PROFILE_ME = '/doctor-profiles/me';
export const API_DOCTOR_PROFILES = '/doctor-profiles';
export const DOCTOR_ROUTES = {
  me: '/api/staff/doctor-profiles/me',
  one: '/api/staff/doctor-profiles',
} as const;
