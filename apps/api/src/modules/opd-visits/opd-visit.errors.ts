import { HttpException } from '@nestjs/common';

/** Stable machine codes. The web maps them to copy; the API carries no UI text. */
export const OpdErrorCode = {
  PATIENT_NOT_FOUND: 'PATIENT_NOT_FOUND',
  DOCTOR_NOT_FOUND: 'DOCTOR_NOT_FOUND',
  DOCTOR_NOT_IN_BRANCH: 'DOCTOR_NOT_IN_BRANCH',
  DOCTOR_UNAVAILABLE: 'DOCTOR_UNAVAILABLE',
  FEE_NOT_CONFIGURED: 'FEE_NOT_CONFIGURED',
  FOLLOW_UP_NEEDS_PREVIOUS_VISIT: 'FOLLOW_UP_NEEDS_PREVIOUS_VISIT',
  PAYMENT_MODE_NOT_AVAILABLE: 'PAYMENT_MODE_NOT_AVAILABLE',
  REFERENCE_REQUIRED: 'REFERENCE_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  TAX_NOT_SUPPORTED: 'TAX_NOT_SUPPORTED',
  NUMBER_SERIES_NOT_CONFIGURED: 'NUMBER_SERIES_NOT_CONFIGURED',
  VISIT_NOT_FOUND: 'VISIT_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
} as const;

export type OpdErrorCode = (typeof OpdErrorCode)[keyof typeof OpdErrorCode];

export function opdError(
  status: number,
  code: OpdErrorCode,
  extra?: Record<string, unknown>,
): HttpException {
  return new HttpException({ statusCode: status, code, ...extra }, status);
}
