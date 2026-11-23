/** Limits and audit names for doctor availability (Step 8b, part D). */
export const AVAILABILITY_CONFIG = {
  /** Time slots one weekday may hold in one branch (a morning and an evening clinic, and a little more). */
  maxSlotsPerDay: 4,
  /** A leave period may cover at most this many days. */
  maxLeaveDays: 366,
  /** A leave period may start at most this many days ahead. */
  maxLeaveStartAheadDays: 731,
  /** Leave periods one doctor may hold at once (past ones included). */
  maxLeavePeriods: 200,
} as const;

export const AVAILABILITY_AUDIT = {
  action: 'DOCTOR_AVAILABILITY_CHANGE',
  entityType: 'doctor_profiles',
} as const;

/** The audit trail keeps ids, dates and times only, never typed text. */
export type AvailabilityChangeKind = 'SWITCH' | 'TIMINGS' | 'LEAVE_ADD' | 'LEAVE_REMOVE';
