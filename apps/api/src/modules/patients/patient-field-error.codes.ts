/**
 * Machine codes for patient register/update validation (no UI text).
 * Returned under `fieldErrors` on 400 responses.
 */
export const PatientFieldErrorCode = {
  REQUIRED: 'REQUIRED',
  INVALID: 'INVALID',
  AGE_AND_DOB_BOTH: 'AGE_AND_DOB_BOTH',
  /** An age cannot replace a real date of birth that is already stored. */
  DOB_KNOWN: 'DOB_KNOWN',
} as const;

export type PatientFieldErrorCode =
  (typeof PatientFieldErrorCode)[keyof typeof PatientFieldErrorCode];

/** Built-in keys match form-config `key`; customs use `custom.<code>`. */
export type PatientFieldErrorKey = string;

export type PatientFieldErrors = Record<PatientFieldErrorKey, PatientFieldErrorCode>;

export function customFieldErrorKey(code: string): string {
  return `custom.${code}`;
}
