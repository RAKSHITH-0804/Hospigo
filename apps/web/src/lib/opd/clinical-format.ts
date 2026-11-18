import { patientsWebConfig } from '@/config/patients';
import { EMPTY_VALUE } from '@/lib/patients/format';

/** Fills {name} placeholders of a copy sentence. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/** Clock time (hours and minutes) in the viewer's own time zone. */
export function formatClock(date: Date, locale: string = patientsWebConfig.dateLocale): string {
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Date and time of an ISO timestamp in the viewer's own time zone. */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string = patientsWebConfig.dateLocale,
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
  }).format(date);
}
