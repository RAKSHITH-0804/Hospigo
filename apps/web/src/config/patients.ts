/**
 * Reception patient-screen limits and list/form constants (env-overridable where noted).
 * No magic numbers or UI strings in components.
 */

export const PatientListSort = {
  NEWEST: 'newest',
  OLDEST: 'oldest',
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  UHID_DESC: 'uhid_desc',
  UHID_ASC: 'uhid_asc',
} as const;

export type PatientListSort = (typeof PatientListSort)[keyof typeof PatientListSort];

export const PATIENT_LIST_SORT_DEFAULT = PatientListSort.NEWEST;

export const PATIENT_LIST_SORT_VALUES: readonly PatientListSort[] = [
  PatientListSort.NEWEST,
  PatientListSort.OLDEST,
  PatientListSort.NAME_ASC,
  PatientListSort.NAME_DESC,
  PatientListSort.UHID_DESC,
  PatientListSort.UHID_ASC,
] as const;

export function isPatientListSort(value: string): value is PatientListSort {
  return (PATIENT_LIST_SORT_VALUES as readonly string[]).includes(value);
}

/** Column ids that can drive list sort (URL `col=`). */
export const PatientListSortColumn = {
  UHID: 'uhid',
  NAME: 'name',
  REGISTERED: 'registered',
} as const;

export type PatientListSortColumn =
  (typeof PatientListSortColumn)[keyof typeof PatientListSortColumn];

export const PATIENT_LIST_SORT_COLUMNS: readonly PatientListSortColumn[] = [
  PatientListSortColumn.UHID,
  PatientListSortColumn.NAME,
  PatientListSortColumn.REGISTERED,
] as const;

export function isPatientListSortColumn(value: string): value is PatientListSortColumn {
  return (PATIENT_LIST_SORT_COLUMNS as readonly string[]).includes(value);
}

/** Default column marker for newest/oldest (Registered on). */
export const PATIENT_LIST_SORT_COLUMN_DEFAULT = PatientListSortColumn.REGISTERED;

/** Phone display groups after country prefix (e.g. +91 70000 00039). */
export const PATIENT_PHONE_DISPLAY_GROUPS = [5, 5] as const;

export function sortPairForColumn(
  column: PatientListSortColumn,
  direction: 'asc' | 'desc',
): PatientListSort {
  if (column === PatientListSortColumn.NAME) {
    return direction === 'asc' ? PatientListSort.NAME_ASC : PatientListSort.NAME_DESC;
  }
  if (column === PatientListSortColumn.UHID) {
    return direction === 'asc' ? PatientListSort.UHID_ASC : PatientListSort.UHID_DESC;
  }
  return direction === 'asc' ? PatientListSort.OLDEST : PatientListSort.NEWEST;
}

export function directionForSort(
  column: PatientListSortColumn,
  sort: PatientListSort,
): 'asc' | 'desc' | null {
  if (column === PatientListSortColumn.NAME) {
    if (sort === PatientListSort.NAME_ASC) return 'asc';
    if (sort === PatientListSort.NAME_DESC) return 'desc';
    return null;
  }
  if (column === PatientListSortColumn.UHID) {
    if (sort === PatientListSort.UHID_ASC) return 'asc';
    if (sort === PatientListSort.UHID_DESC) return 'desc';
    return null;
  }
  if (sort === PatientListSort.OLDEST) return 'asc';
  if (sort === PatientListSort.NEWEST) return 'desc';
  return null;
}

/** The column a sort value belongs to (used when the URL `col=` is missing or disagrees). */
export function columnForSort(sort: PatientListSort): PatientListSortColumn {
  if (sort === PatientListSort.NAME_ASC || sort === PatientListSort.NAME_DESC) {
    return PatientListSortColumn.NAME;
  }
  if (sort === PatientListSort.UHID_ASC || sort === PatientListSort.UHID_DESC) {
    return PatientListSortColumn.UHID;
  }
  return PATIENT_LIST_SORT_COLUMN_DEFAULT;
}

/** First click: Name A-Z, UHID highest first, Registered on newest first; the next click reverses. */
export function toggleSortForColumn(
  column: PatientListSortColumn,
  currentSort: PatientListSort,
  currentCol: PatientListSortColumn,
): PatientListSort {
  const active = currentCol === column ? directionForSort(column, currentSort) : null;
  if (column === PatientListSortColumn.NAME) {
    return active === 'asc' ? PatientListSort.NAME_DESC : PatientListSort.NAME_ASC;
  }
  if (column === PatientListSortColumn.UHID) {
    return active === 'desc' ? PatientListSort.UHID_ASC : PatientListSort.UHID_DESC;
  }
  return active === 'desc' ? PatientListSort.OLDEST : PatientListSort.NEWEST;
}

/** Form-config section codes in display order (RELATIVE last, collapsed). */
export const PATIENT_FORM_SECTION_ORDER = [
  'PERSONAL',
  'CONTACT',
  'ADDRESS',
  'OTHER',
  'RELATIVE',
] as const;

export type PatientFormSection = (typeof PATIENT_FORM_SECTION_ORDER)[number];

export const PATIENT_FORM_SECTION_RELATIVE = 'RELATIVE' as const;

/** Default age-or-DOB control mode for register: the date of birth first, age only when it is not known. */
export const PATIENT_FORM_DEFAULT_DOB_MODE = 'dob' as const;

/** Age entry: months (0 to 11) and days (0 to 30) next to the years. */
export const PATIENT_AGE_MONTHS_MAX = 11;
export const PATIENT_AGE_DAYS_MAX = 30;

/** Grid column spans on the 12-col register form (wide). */
export const PATIENT_FORM_SPAN_BY_DATA_TYPE = {
  TEXT: 4,
  NUMBER: 2,
  DATE: 2,
  DROPDOWN: 2,
} as const;

/** Explicit spans keyed by form-config field key or custom code. */
export const PATIENT_FORM_FIELD_SPANS: Readonly<Record<string, number>> = {
  name: 4,
  gender: 2,
  date_of_birth: 3,
  phone: 3,
  email: 4,
  address_street: 4,
  address_cross: 3,
  address_area: 3,
  address_city: 2,
  address_state: 3,
  address_pincode: 2,
  referred_by: 3,
  category: 3,
  organisation: 3,
  staff_number: 3,
};

export function patientFormFieldSpan(field: {
  key?: string | null;
  code?: string | null;
  dataType: string;
}): number {
  const id = field.key || field.code || '';
  if (id && PATIENT_FORM_FIELD_SPANS[id] != null) {
    return PATIENT_FORM_FIELD_SPANS[id];
  }
  const byType =
    PATIENT_FORM_SPAN_BY_DATA_TYPE[field.dataType as keyof typeof PATIENT_FORM_SPAN_BY_DATA_TYPE];
  return byType ?? PATIENT_FORM_SPAN_BY_DATA_TYPE.TEXT;
}

/** Stable form element id so page-header actions can submit via the `form` attribute. */
export const PATIENT_FORM_ELEMENT_ID = 'patient-form';

export type PatientsWebConfig = {
  /** Minimum characters before a live search runs (matches the API q minimum). */
  searchMinLength: number;
  /** Longest search text accepted (matches the API q maximum). */
  searchMaxLength: number;
  /** Pause after the last keystroke before a live search runs. */
  searchDebounceMs: number;
  searchPageSize: number;
  searchMaxPageSize: number;
  /** CSS @page size keyword used for the registration slip. */
  slipPaperSize: string;
  /** CSS @page margin for the slip (0 hides the browser's own date/URL header and footer). */
  slipPageMargin: string;
  phoneCountryCodePrefix: string;
  phoneNationalLength: number;
  pincodeLength: number;
  ageMin: number;
  ageMax: number;
  ageMaxDigits: number;
  /** Intl locale for registered-on dates. */
  dateLocale: string;
  listSortDefault: PatientListSort;
};

const DEFAULTS: PatientsWebConfig = {
  searchMinLength: 2,
  searchMaxLength: 64,
  searchDebounceMs: 250,
  searchPageSize: 20,
  searchMaxPageSize: 50,
  slipPaperSize: 'A4',
  slipPageMargin: '0',
  phoneCountryCodePrefix: '+91',
  phoneNationalLength: 10,
  pincodeLength: 6,
  ageMin: 0,
  ageMax: 150,
  ageMaxDigits: 3,
  dateLocale: 'en-IN',
  listSortDefault: PATIENT_LIST_SORT_DEFAULT,
};

function intEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  return n;
}

function strEnv(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw.trim();
}

export function loadPatientsWebConfig(
  env: Record<string, string | undefined> = process.env,
): PatientsWebConfig {
  const searchMaxPageSize = intEnv(
    env,
    'WEB_PATIENT_SEARCH_MAX_PAGE_SIZE',
    DEFAULTS.searchMaxPageSize,
    1,
    100,
  );
  const searchPageSize = intEnv(
    env,
    'WEB_PATIENT_SEARCH_PAGE_SIZE',
    DEFAULTS.searchPageSize,
    1,
    searchMaxPageSize,
  );
  const sortRaw = strEnv(env, 'WEB_PATIENT_LIST_SORT_DEFAULT', DEFAULTS.listSortDefault);
  const listSortDefault = isPatientListSort(sortRaw) ? sortRaw : DEFAULTS.listSortDefault;
  return {
    searchMinLength: intEnv(env, 'WEB_PATIENT_SEARCH_MIN_LENGTH', DEFAULTS.searchMinLength, 1, 50),
    searchMaxLength: intEnv(env, 'WEB_PATIENT_SEARCH_MAX_LENGTH', DEFAULTS.searchMaxLength, 1, 200),
    searchDebounceMs: intEnv(
      env,
      'WEB_PATIENT_SEARCH_DEBOUNCE_MS',
      DEFAULTS.searchDebounceMs,
      0,
      5000,
    ),
    searchPageSize,
    searchMaxPageSize,
    slipPaperSize: strEnv(env, 'WEB_PATIENT_SLIP_PAPER_SIZE', DEFAULTS.slipPaperSize),
    slipPageMargin: strEnv(env, 'WEB_PATIENT_SLIP_PAGE_MARGIN', DEFAULTS.slipPageMargin),
    phoneCountryCodePrefix: strEnv(
      env,
      'WEB_PATIENT_PHONE_COUNTRY_PREFIX',
      DEFAULTS.phoneCountryCodePrefix,
    ),
    phoneNationalLength: intEnv(
      env,
      'WEB_PATIENT_PHONE_NATIONAL_LENGTH',
      DEFAULTS.phoneNationalLength,
      8,
      15,
    ),
    pincodeLength: intEnv(env, 'WEB_PATIENT_PINCODE_LENGTH', DEFAULTS.pincodeLength, 4, 12),
    ageMin: intEnv(env, 'WEB_PATIENT_AGE_MIN', DEFAULTS.ageMin, 0, 200),
    ageMax: intEnv(env, 'WEB_PATIENT_AGE_MAX', DEFAULTS.ageMax, 0, 200),
    ageMaxDigits: intEnv(env, 'WEB_PATIENT_AGE_MAX_DIGITS', DEFAULTS.ageMaxDigits, 1, 4),
    dateLocale: strEnv(env, 'WEB_PATIENT_DATE_LOCALE', DEFAULTS.dateLocale),
    listSortDefault,
  };
}

export const patientsWebConfig = loadPatientsWebConfig();
