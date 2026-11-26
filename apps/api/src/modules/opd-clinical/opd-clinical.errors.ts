import { HttpException } from '@nestjs/common';

/** Stable machine codes. The web maps them to copy; the API carries no UI text. */
export const ClinicalErrorCode = {
  VISIT_NOT_FOUND: 'VISIT_NOT_FOUND',
  /** A note action by a user who has no doctor profile. */
  DOCTOR_PROFILE_REQUIRED: 'DOCTOR_PROFILE_REQUIRED',
  ADDENDUM_INVALID: 'ADDENDUM_INVALID',
  /** Start: the visit is not waiting (still unpaid, already completed or cancelled). */
  VISIT_NOT_WAITING: 'VISIT_NOT_WAITING',
  /** Note, prescription, complete: the consultation has not been started (or is over). */
  VISIT_NOT_IN_CONSULTATION: 'VISIT_NOT_IN_CONSULTATION',
  NOTE_NOT_FOUND: 'NOTE_NOT_FOUND',
  NOTE_ALREADY_COMPLETED: 'NOTE_ALREADY_COMPLETED',
  NOTE_EMPTY: 'NOTE_EMPTY',
  FOLLOW_UP_DATE_INVALID: 'FOLLOW_UP_DATE_INVALID',
  ADDENDUM_NEEDS_COMPLETED_NOTE: 'ADDENDUM_NEEDS_COMPLETED_NOTE',
  /** Step 2.1b: addenda are over; an Admin changes a completed note as a new version. */
  ADDENDUM_RETIRED: 'ADDENDUM_RETIRED',
  /** Amend: the note is not completed yet (the doctor still edits it), or nothing changed, or no reason. */
  AMEND_NEEDS_COMPLETED_NOTE: 'AMEND_NEEDS_COMPLETED_NOTE',
  AMEND_REASON_REQUIRED: 'AMEND_REASON_REQUIRED',
  AMEND_NOTHING_CHANGED: 'AMEND_NOTHING_CHANGED',
  MEDICINE_NOT_FOUND: 'MEDICINE_NOT_FOUND',
  PRESCRIPTION_ITEM_INVALID: 'PRESCRIPTION_ITEM_INVALID',
  VITALS_VISIT_NOT_OPEN: 'VITALS_VISIT_NOT_OPEN',
  VITALS_FIELD_NOT_FOUND: 'VITALS_FIELD_NOT_FOUND',
  VITALS_FIELD_DUPLICATE: 'VITALS_FIELD_DUPLICATE',
  VITALS_VALUE_INVALID: 'VITALS_VALUE_INVALID',
  VITALS_CORRECTION_REASON_REQUIRED: 'VITALS_CORRECTION_REASON_REQUIRED',
} as const;

export type ClinicalErrorCode = (typeof ClinicalErrorCode)[keyof typeof ClinicalErrorCode];

export function clinicalError(
  status: number,
  code: ClinicalErrorCode,
  extra?: Record<string, unknown>,
): HttpException {
  return new HttpException({ statusCode: status, code, ...extra }, status);
}
