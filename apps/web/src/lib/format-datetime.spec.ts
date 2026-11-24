import { opdWebConfig } from '@/config/opd';
import { patientsWebConfig } from '@/config/patients';
import { EMPTY_VALUE } from '@/lib/patients/format';
import { formatClock, formatDateTime, formatDateTimeLong } from '@/lib/format-datetime';

describe('format-datetime (fixed locale and hospital time zone)', () => {
  const iso = '2026-11-16T04:33:29.000Z';

  it('formatDateTime uses the hospital zone and the configured locale', () => {
    const expected = new Intl.DateTimeFormat(patientsWebConfig.dateLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: opdWebConfig.reportTimeZone,
    }).format(new Date(iso));
    expect(formatDateTime(iso)).toBe(expected);
  });

  it('formatDateTimeLong includes seconds and stays stable for the same instant', () => {
    const a = formatDateTimeLong(iso);
    const b = formatDateTimeLong(iso);
    expect(a).toBe(b);
    expect(a).toMatch(/29/);
  });

  it('formatClock uses the hospital zone', () => {
    const date = new Date(iso);
    const expected = new Intl.DateTimeFormat(patientsWebConfig.dateLocale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: opdWebConfig.reportTimeZone,
    }).format(date);
    expect(formatClock(date)).toBe(expected);
  });

  it('empty or bad values become the empty glyph', () => {
    expect(formatDateTime(null)).toBe(EMPTY_VALUE);
    expect(formatDateTime('not-a-date')).toBe(EMPTY_VALUE);
    expect(formatDateTimeLong(undefined)).toBe(EMPTY_VALUE);
    expect(formatClock(new Date('nope'))).toBe(EMPTY_VALUE);
  });
});
