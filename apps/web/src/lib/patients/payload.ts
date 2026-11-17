import { PATIENT_FORM_DEFAULT_DOB_MODE } from '@/config/patients';
import { nationalPhoneDigits } from './format';
import type {
  CustomFieldValue,
  FormConfigField,
  PatientDetail,
  RegisterPatientBody,
} from './types';

export type DobMode = 'dob' | 'age';

export const TEXT_KEYS = [
  'name',
  'gender',
  'phone',
  'email',
  'addressStreet',
  'addressCross',
  'addressArea',
  'addressCity',
  'addressState',
  'addressPincode',
] as const;

export type TextKey = (typeof TEXT_KEYS)[number];

export type FormValues = Record<TextKey, string> & {
  dobMode: DobMode;
  dateOfBirth: string;
  ageYears: string;
  custom: Record<string, string>;
};

/** Catalog keys the API uses for the standard fields. */
export const CATALOG_KEY: Record<TextKey | 'dateOfBirth', string> = {
  name: 'name',
  gender: 'gender',
  dateOfBirth: 'date_of_birth',
  phone: 'phone',
  email: 'email',
  addressStreet: 'address_street',
  addressCross: 'address_cross',
  addressArea: 'address_area',
  addressCity: 'address_city',
  addressState: 'address_state',
  addressPincode: 'address_pincode',
};

/** Custom field data types the form can render. */
export const SUPPORTED_CUSTOM_TYPES = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN'] as const;

export function isSupportedCustomType(dataType: string): boolean {
  return (SUPPORTED_CUSTOM_TYPES as readonly string[]).includes(dataType);
}

export function emptyValues(): FormValues {
  return {
    name: '',
    gender: '',
    phone: '',
    email: '',
    addressStreet: '',
    addressCross: '',
    addressArea: '',
    addressCity: '',
    addressState: '',
    addressPincode: '',
    dobMode: PATIENT_FORM_DEFAULT_DOB_MODE,
    dateOfBirth: '',
    ageYears: '',
    custom: {},
  };
}

function customValueToString(value: CustomFieldValue): string {
  if (value.optionId) {
    return value.optionId;
  }
  if (value.valueText) {
    return value.valueText;
  }
  if (value.valueNumber !== null && value.valueNumber !== undefined) {
    return String(value.valueNumber);
  }
  if (value.valueDate) {
    return value.valueDate.slice(0, 10);
  }
  return '';
}

export function valuesFromDetail(detail: PatientDetail): FormValues {
  const estimated = detail.dobIsEstimated && detail.ageYears !== null;
  const custom: Record<string, string> = {};
  for (const item of detail.customFieldValues ?? []) {
    custom[item.code] = customValueToString(item);
  }
  return {
    name: detail.name ?? '',
    gender: detail.gender ?? '',
    phone: nationalPhoneDigits(detail.phone ?? ''),
    email: detail.email ?? '',
    addressStreet: detail.addressStreet ?? '',
    addressCross: detail.addressCross ?? '',
    addressArea: detail.addressArea ?? '',
    addressCity: detail.addressCity ?? '',
    addressState: detail.addressState ?? '',
    addressPincode: detail.addressPincode ?? '',
    dobMode: estimated ? 'age' : 'dob',
    dateOfBirth: estimated ? '' : (detail.dateOfBirth?.slice(0, 10) ?? ''),
    ageYears: estimated ? String(detail.ageYears) : '',
    custom,
  };
}

function customEntry(field: FormConfigField, raw: string): CustomFieldValue | null {
  const code = field.code;
  const value = raw.trim();
  if (!code || !value) {
    return null;
  }
  switch (field.dataType) {
    case 'TEXT':
      return { code, valueText: value };
    case 'NUMBER':
      return { code, valueNumber: Number(value) };
    case 'DATE':
      return { code, valueDate: value };
    case 'DROPDOWN':
      return { code, optionId: value };
    default:
      return null;
  }
}

/**
 * Build a request body. Without `initial` (register) every filled field is sent.
 * With `initial` (edit) only changed, non-empty values are sent.
 * Age and date of birth are never sent together.
 */
export function buildPatientBody(
  values: FormValues,
  customFields: FormConfigField[],
  initial?: FormValues,
): Partial<RegisterPatientBody> {
  const body: Record<string, unknown> = {};

  for (const key of TEXT_KEYS) {
    const next = values[key].trim();
    if (!next) {
      continue;
    }
    if (initial && initial[key].trim() === next) {
      continue;
    }
    body[key] = next;
  }

  if (values.dobMode === 'dob') {
    const next = values.dateOfBirth.trim();
    if (next && (!initial || initial.dobMode !== 'dob' || initial.dateOfBirth !== next)) {
      body.dateOfBirth = next;
    }
  } else {
    const next = values.ageYears.trim();
    if (next && (!initial || initial.dobMode !== 'age' || initial.ageYears !== next)) {
      body.ageYears = Number(next);
    }
  }

  const customFieldValues: CustomFieldValue[] = [];
  for (const field of customFields) {
    const code = field.code;
    if (!code) {
      continue;
    }
    const next = values.custom[code] ?? '';
    if (initial && (initial.custom[code] ?? '') === next) {
      continue;
    }
    const entry = customEntry(field, next);
    if (entry) {
      customFieldValues.push(entry);
    }
  }
  if (customFieldValues.length > 0) {
    body.customFieldValues = customFieldValues;
  }

  return body as Partial<RegisterPatientBody>;
}

export function isEmptyBody(body: object): boolean {
  return Object.keys(body).length === 0;
}
