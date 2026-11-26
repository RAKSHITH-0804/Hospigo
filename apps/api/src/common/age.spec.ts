import { ageParts, dobFromAge } from './age';

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe('age from a date of birth', () => {
  it('1 Jan 2000 is 26 years on 26 Nov 2026 and 27 years on 2 Feb 2027', () => {
    expect(ageParts(d(2000, 1, 1), d(2026, 11, 26)).years).toBe(26);
    expect(ageParts(d(2000, 1, 1), d(2027, 2, 2)).years).toBe(27);
  });
  it('counts months and days, borrowing from the month before', () => {
    expect(ageParts(d(2026, 6, 14), d(2026, 11, 26))).toEqual({ years: 0, months: 5, days: 12 });
    expect(ageParts(d(2026, 11, 20), d(2026, 11, 26))).toEqual({ years: 0, months: 0, days: 6 });
  });
  it('a birthday not reached yet does not count', () => {
    expect(ageParts(d(2000, 12, 25), d(2026, 11, 26)).years).toBe(25);
  });
  it('never goes below zero', () => {
    expect(ageParts(d(2027, 1, 1), d(2026, 11, 26))).toEqual({ years: 0, months: 0, days: 0 });
  });
});

describe('estimated date of birth from an age entry', () => {
  it('70 years today is 70 years, and one year later 71', () => {
    const dob = dobFromAge(d(2026, 11, 26), { years: 70, months: 0, days: 0 });
    expect(dob).toEqual(d(1956, 11, 26));
    expect(ageParts(dob, d(2027, 11, 26)).years).toBe(71);
  });
  it('a baby of 5 months 12 days', () => {
    const dob = dobFromAge(d(2026, 11, 26), { years: 0, months: 5, days: 12 });
    expect(dob).toEqual(d(2026, 6, 14));
    expect(ageParts(dob, d(2026, 11, 26))).toEqual({ years: 0, months: 5, days: 12 });
  });
  it('2 years 3 months round trip', () => {
    const dob = dobFromAge(d(2026, 11, 26), { years: 2, months: 3, days: 0 });
    expect(ageParts(dob, d(2026, 11, 26))).toEqual({ years: 2, months: 3, days: 0 });
  });
  it('a month-end day moves back to the shorter month', () => {
    expect(dobFromAge(d(2026, 3, 31), { years: 0, months: 1, days: 0 })).toEqual(d(2026, 2, 28));
  });
  it('days larger than the day of the month go back across months and years', () => {
    expect(dobFromAge(d(2026, 1, 5), { years: 0, months: 0, days: 10 })).toEqual(d(2025, 12, 26));
  });
});
