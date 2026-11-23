import { zonedParts } from '../patients/uhid.util';

/** A real calendar date written YYYY-MM-DD (no 31 February). */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    return false;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Today's date (YYYY-MM-DD) in the hospital's time zone. */
export function localDate(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The moment 00:00 of that date in the hospital's time zone, as a UTC instant. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wanted = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = wanted;
  // Two passes settle the offset (also across a daylight saving change).
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    guess = guess - (wall - wanted);
  }
  return new Date(guess);
}
