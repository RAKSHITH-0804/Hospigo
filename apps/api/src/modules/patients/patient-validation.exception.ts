import { BadRequestException } from '@nestjs/common';
import type { PatientFieldErrors } from './patient-field-error.codes';

/**
 * 400 body keeps Nest-compatible `message` and adds `fieldErrors` (codes only).
 */
export function throwPatientFieldErrors(
  fieldErrors: PatientFieldErrors,
  message: string | string[],
): never {
  throw new BadRequestException({
    statusCode: 400,
    message,
    error: 'Bad Request',
    fieldErrors,
  });
}

export function patientFieldErrorsBody(
  fieldErrors: PatientFieldErrors,
  message: string | string[],
): {
  statusCode: 400;
  message: string | string[];
  error: 'Bad Request';
  fieldErrors: PatientFieldErrors;
} {
  return {
    statusCode: 400,
    message,
    error: 'Bad Request',
    fieldErrors,
  };
}
