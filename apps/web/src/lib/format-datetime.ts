import { opdWebConfig } from '@/config/opd';
import { patientsWebConfig } from '@/config/patients';
import { EMPTY_VALUE } from '@/lib/patients/format';

/**
 * ONE place that turns an instant into text for the staff UI. Always uses the configured locale
 * and the hospital time zone, so the server and the browser print the same string (no hydration
 * mismatch from the viewer's own zone).
 */

export function hospitalTimeZone(): string {
  return opdWebConfig.reportTimeZone;
}

/** The hour (0 to 23) of a moment in the hospital time zone (for the greeting). */
export function hospitalHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: hospitalTimeZone(),
    }).format(date),
  );
}

export function dateLocale(): string {
  return patientsWebConfig.dateLocale;
}

/** Clock time (hours and minutes) in the hospital time zone. */
export function formatClock(
  date: Date,
  locale: string = dateLocale(),
  timeZone: string = hospitalTimeZone(),
): string {
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** Date and time of an ISO timestamp in the hospital time zone. */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string = dateLocale(),
  timeZone: string = hospitalTimeZone(),
): string {
  if (!iso) {
    return EMPTY_VALUE;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/**
 * A longer date-and-time for admin lists (for example last sign-in). Same zone and locale as
 * formatDateTime, with seconds so two close events stay distinct.
 */
export function formatDateTimeLong(
  iso: string | null | undefined,
  locale: string = dateLocale(),
  timeZone: string = hospitalTimeZone(),
): string {
  if (!iso) {
    return EMPTY_VALUE;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
  }).format(date);
}
