import { isRealDate } from '../opd-prices/local-date';
import { AVAILABILITY_CONFIG as C } from './availability.config';

/** A refusal with the field and a stable reason code (the web screen shows plain words for it). */
export class AvailabilityRuleError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

export type Slot = { weekday: number; start: string; end: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function only(body: Record<string, unknown>, allowed: string[], field: string): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new AvailabilityRuleError(field, 'UNKNOWN_FIELD');
    }
  }
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

export function parseSwitch(body: unknown): { availabilityOn: boolean } {
  if (!isObject(body)) {
    throw new AvailabilityRuleError('availabilityOn', 'REQUIRED');
  }
  only(body, ['availabilityOn'], 'availabilityOn');
  if (typeof body.availabilityOn !== 'boolean') {
    throw new AvailabilityRuleError('availabilityOn', 'NOT_A_BOOLEAN');
  }
  return { availabilityOn: body.availabilityOn };
}

/** The whole weekly timetable of ONE branch. An empty list clears it (no timings, no warnings). */
export function parseTimings(body: unknown): Slot[] {
  if (!isObject(body)) {
    throw new AvailabilityRuleError('slots', 'REQUIRED');
  }
  only(body, ['slots'], 'slots');
  if (!Array.isArray(body.slots)) {
    throw new AvailabilityRuleError('slots', 'REQUIRED');
  }
  if (body.slots.length > C.maxSlotsPerDay * 7) {
    throw new AvailabilityRuleError('slots', 'TOO_MANY');
  }
  const slots: Slot[] = [];
  for (const raw of body.slots as unknown[]) {
    if (!isObject(raw)) {
      throw new AvailabilityRuleError('slots', 'SLOT_INVALID');
    }
    only(raw, ['weekday', 'start', 'end'], 'slots');
    const { weekday, start, end } = raw;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new AvailabilityRuleError('weekday', 'WEEKDAY_INVALID');
    }
    if (typeof start !== 'string' || !TIME.test(start)) {
      throw new AvailabilityRuleError('start', 'TIME_INVALID');
    }
    if (typeof end !== 'string' || !TIME.test(end)) {
      throw new AvailabilityRuleError('end', 'TIME_INVALID');
    }
    if (toMinutes(end) <= toMinutes(start)) {
      throw new AvailabilityRuleError('end', 'END_BEFORE_START');
    }
    slots.push({ weekday, start, end });
  }
  for (let day = 0; day <= 6; day += 1) {
    const ofDay = slots
      .filter((s) => s.weekday === day)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    if (ofDay.length > C.maxSlotsPerDay) {
      throw new AvailabilityRuleError('slots', 'TOO_MANY_PER_DAY');
    }
    for (let i = 1; i < ofDay.length; i += 1) {
      // Touching is fine (09:00-13:00 then 13:00-17:00); an overlap is not.
      if (toMinutes(ofDay[i]!.start) < toMinutes(ofDay[i - 1]!.end)) {
        throw new AvailabilityRuleError('slots', 'OVERLAP');
      }
    }
  }
  return slots.sort((a, b) => a.weekday - b.weekday || toMinutes(a.start) - toMinutes(b.start));
}

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export type LeavePeriod = { fromDate: string; toDate: string };

/** One leave period (first and last day, both included). `today` is the date at the hospital. */
export function parseLeave(body: unknown, today: string): LeavePeriod {
  if (!isObject(body)) {
    throw new AvailabilityRuleError('fromDate', 'REQUIRED');
  }
  only(body, ['fromDate', 'toDate'], 'fromDate');
  const { fromDate, toDate } = body;
  if (typeof fromDate !== 'string' || !isRealDate(fromDate)) {
    throw new AvailabilityRuleError('fromDate', 'DATE_INVALID');
  }
  if (typeof toDate !== 'string' || !isRealDate(toDate)) {
    throw new AvailabilityRuleError('toDate', 'DATE_INVALID');
  }
  if (toDate < fromDate) {
    throw new AvailabilityRuleError('toDate', 'END_BEFORE_START');
  }
  if (toDate < today) {
    throw new AvailabilityRuleError('toDate', 'DATE_IN_PAST');
  }
  if (dayNumber(toDate) - dayNumber(fromDate) + 1 > C.maxLeaveDays) {
    throw new AvailabilityRuleError('toDate', 'TOO_LONG');
  }
  if (dayNumber(fromDate) - dayNumber(today) > C.maxLeaveStartAheadDays) {
    throw new AvailabilityRuleError('fromDate', 'TOO_FAR');
  }
  return { fromDate, toDate };
}

/** Two periods overlap when they share a day (the last day counts). */
export const leavesOverlap = (a: LeavePeriod, b: LeavePeriod): boolean =>
  a.fromDate <= b.toDate && b.fromDate <= a.toDate;
