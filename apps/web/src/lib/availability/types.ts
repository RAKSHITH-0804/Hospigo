/** What the doctor availability API answers (Step 8b, part D). The API checks every value. */

export type AvailabilityBranch = { id: string; name: string; editable: boolean };

export type AvailabilityTiming = {
  id: string;
  branchId: string;
  /** 0 is Sunday ... 6 is Saturday. */
  weekday: number;
  /** HH:MM */
  start: string;
  end: string;
};

export type AvailabilityLeave = { id: string; fromDate: string; toDate: string };

export type Availability = {
  doctorProfileId: string;
  code: string;
  name: string;
  availabilityOn: boolean;
  /** The date at the hospital today (YYYY-MM-DD). */
  today: string;
  branches: AvailabilityBranch[];
  timings: AvailabilityTiming[];
  leaves: AvailabilityLeave[];
  canWrite: boolean;
};

export type SlotBody = { weekday: number; start: string; end: string };

/** Next route handlers (browser side) that proxy the API. */
export const AVAILABILITY_ROUTES = {
  base: '/api/staff/opd/doctors',
} as const;

export const availabilityPath = (doctorId: string, tail = ''): string =>
  `${AVAILABILITY_ROUTES.base}/${encodeURIComponent(doctorId)}/availability${tail}`;
