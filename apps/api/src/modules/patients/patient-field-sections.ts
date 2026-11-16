/**
 * Form-config section catalog. Order here is the stable section order
 * returned to clients (fields are sorted by section, then sortOrder).
 */
export const PatientFieldSection = {
  PERSONAL: 'PERSONAL',
  CONTACT: 'CONTACT',
  ADDRESS: 'ADDRESS',
  RELATIVE: 'RELATIVE',
  OTHER: 'OTHER',
} as const;

export type PatientFieldSection = (typeof PatientFieldSection)[keyof typeof PatientFieldSection];

export const PATIENT_FIELD_SECTION_ORDER: readonly PatientFieldSection[] = [
  PatientFieldSection.PERSONAL,
  PatientFieldSection.CONTACT,
  PatientFieldSection.ADDRESS,
  PatientFieldSection.RELATIVE,
  PatientFieldSection.OTHER,
] as const;

const SECTION_RANK: Record<PatientFieldSection, number> = {
  PERSONAL: 0,
  CONTACT: 1,
  ADDRESS: 2,
  RELATIVE: 3,
  OTHER: 4,
};

export function isPatientFieldSection(value: string): value is PatientFieldSection {
  return Object.prototype.hasOwnProperty.call(SECTION_RANK, value);
}

export function patientFieldSectionRank(section: string): number {
  if (isPatientFieldSection(section)) {
    return SECTION_RANK[section];
  }
  return SECTION_RANK.OTHER;
}

/** Built-in catalog key → default section (source of truth for form-config). */
export const BUILTIN_FIELD_DEFAULT_SECTION: Record<string, PatientFieldSection> = {
  name: PatientFieldSection.PERSONAL,
  gender: PatientFieldSection.PERSONAL,
  date_of_birth: PatientFieldSection.PERSONAL,
  phone: PatientFieldSection.CONTACT,
  email: PatientFieldSection.CONTACT,
  address_street: PatientFieldSection.ADDRESS,
  address_cross: PatientFieldSection.ADDRESS,
  address_area: PatientFieldSection.ADDRESS,
  address_city: PatientFieldSection.ADDRESS,
  address_state: PatientFieldSection.ADDRESS,
  address_pincode: PatientFieldSection.ADDRESS,
};
