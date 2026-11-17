/** Shapes aligned with docs/api-opd.md and the patients API DTOs. */

export type PatientSearchItem = {
  id: string;
  uhid: string;
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  ageYears: number | null;
  dobIsEstimated: boolean;
  phone: string | null;
  registeredBranchId: string;
  registeredBranchName?: string;
  createdAt?: string;
  isActive: boolean;
};

export type PatientSearchResponse = {
  items: PatientSearchItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type PatientListItem = PatientSearchItem & {
  createdAt: string;
  registeredBranchName: string;
};

export type PatientListResponse = {
  items: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type FormConfigField = {
  key?: string;
  code?: string;
  label: string;
  dataType: string;
  required: boolean;
  sortOrder: number;
  section?: string;
  options?: Array<{ id: string; label: string; sortOrder: number }>;
};

export type FormConfigResponse = { fields: FormConfigField[] };

export type CustomFieldValue = {
  code: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: string | null;
  optionId?: string | null;
  optionLabel?: string | null;
};

export type PatientDetail = {
  id: string;
  uhid: string;
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  ageYears: number | null;
  dobIsEstimated: boolean;
  phone: string | null;
  email: string | null;
  addressStreet: string | null;
  addressCross: string | null;
  addressArea: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPincode: string | null;
  registeredBranchId: string;
  isActive: boolean;
  customFieldValues: CustomFieldValue[];
};

export type DuplicateMatch = { id: string; uhid: string; name: string };

export type UhidStartNumberResponse = {
  nextNumber: number;
  nextUhidPreview: string;
  resetRule: string;
  periodYear: number;
  periodLabel: string | null;
};

export type RegisterPatientBody = {
  name: string;
  gender?: string;
  dateOfBirth?: string;
  ageYears?: number;
  phone?: string;
  email?: string;
  addressStreet?: string;
  addressCross?: string;
  addressArea?: string;
  addressCity?: string;
  addressState?: string;
  addressPincode?: string;
  customFieldValues?: CustomFieldValue[];
  confirmDuplicate?: boolean;
};

/** API fieldErrors codes (docs/api-opd.md). */
export type PatientFieldErrorCode = 'REQUIRED' | 'INVALID' | 'AGE_AND_DOB_BOTH';
