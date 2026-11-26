/**
 * Age maths on calendar dates (no time zones here: callers pass the hospital's local day).
 * An age is always worked out from the date of birth, so it grows by itself every day.
 */
export type YMD = { year: number; month: number; day: number };
export type AgeParts = { years: number; months: number; days: number };

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whole years, months and days from a date of birth to a day (never negative). */
export function ageParts(dob: YMD, today: YMD): AgeParts {
  let years = today.year - dob.year;
  let months = today.month - dob.month;
  let days = today.day - dob.day;
  if (days < 0) {
    months -= 1;
    const prevMonth = today.month === 1 ? 12 : today.month - 1;
    const prevYear = today.month === 1 ? today.year - 1 : today.year;
    days += daysInMonth(prevYear, prevMonth);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) {
    return { years: 0, months: 0, days: 0 };
  }
  return { years, months, days };
}

/**
 * The estimated date of birth for an age the patient only says out loud: the local day minus the
 * years, months and days. A month-end day is moved back to the last day of the shorter month.
 */
export function dobFromAge(today: YMD, age: AgeParts): YMD {
  let year = today.year - age.years;
  let month = today.month - age.months;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  let day = Math.min(today.day, daysInMonth(year, month));
  day -= age.days;
  while (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day += daysInMonth(year, month);
  }
  return { year, month, day };
}
