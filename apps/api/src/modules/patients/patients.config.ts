/**
 * Patient registry list/search config constants (no magic numbers in services).
 * Page-size and name-min still come from env (`PATIENT_SEARCH_*`).
 */

export const PatientListSort = {
  NEWEST: 'newest',
  OLDEST: 'oldest',
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
} as const;

export type PatientListSort = (typeof PatientListSort)[keyof typeof PatientListSort];

export const PATIENT_LIST_SORT_DEFAULT = PatientListSort.NEWEST;

export const PATIENT_LIST_SORT_VALUES: readonly PatientListSort[] = [
  PatientListSort.NEWEST,
  PatientListSort.OLDEST,
  PatientListSort.NAME_ASC,
  PatientListSort.NAME_DESC,
] as const;

export function isPatientListSort(value: string): value is PatientListSort {
  return (PATIENT_LIST_SORT_VALUES as readonly string[]).includes(value);
}

/** Indian PIN / postal code length when the value is provided. */
export const PATIENT_PINCODE_LENGTH = 6;

/** National mobile length stored after +91 (E.164). */
export const PATIENT_PHONE_NATIONAL_LENGTH = 10;

/** Default page size when caller omits pageSize (same idea as search). */
export const PATIENT_LIST_DEFAULT_PAGE_SIZE = 20;

/**
 * Free-text list `q` defaults (env-overridable via PATIENT_LIST_Q_*).
 * Used when the caller types before choosing phone/UHID/name mode.
 */
export const PATIENT_LIST_Q_MAX_LENGTH = 64;
export const PATIENT_LIST_Q_MIN_NAME_LENGTH = 2;
export const PATIENT_LIST_Q_MIN_UHID_LENGTH = 2;
export const PATIENT_LIST_Q_MIN_PHONE_DIGITS = 3;
