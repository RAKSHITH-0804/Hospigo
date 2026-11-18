/**
 * Calendar maths on plain days ("YYYY-MM-DD"), done in UTC so a day never shifts with the time
 * zone. No time of day anywhere: a follow-up date is a calendar day.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const GRID_CELLS = 42;

export type CalendarCell = { iso: string; day: number; inMonth: boolean };

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A real calendar day as UTC midnight, or null (so "2027-02-30" is refused, not rolled over). */
export function parseIsoDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return null;
  }
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && toIsoDay(date) === iso ? date : null;
}

export function addDays(iso: string, days: number): string {
  const date = parseIsoDay(iso);
  if (!date) {
    throw new Error(`Not a calendar day: ${iso}`);
  }
  return toIsoDay(new Date(date.getTime() + days * DAY_MS));
}

/** The viewer's own calendar day (what the wall calendar shows), as YYYY-MM-DD. */
export function localTodayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The six weeks (42 days) shown for one month; days of the neighbour months are marked. */
export function monthGrid(year: number, month0: number, weekStart: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (first.getUTCDay() - weekStart + 7) % 7;
  const start = first.getTime() - offset * DAY_MS;
  return Array.from({ length: GRID_CELLS }, (_, i) => {
    const date = new Date(start + i * DAY_MS);
    return {
      iso: toIsoDay(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month0,
    };
  });
}

export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const index = year * 12 + month0 + delta;
  return { year: Math.floor(index / 12), month0: ((index % 12) + 12) % 12 };
}

/** Weekday numbers (0 = Sunday) in the order the week is shown. */
export function weekdayOrder(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/** ISO days compare correctly as plain text. */
export function isWithin(iso: string, min?: string, max?: string): boolean {
  return (min === undefined || iso >= min) && (max === undefined || iso <= max);
}
