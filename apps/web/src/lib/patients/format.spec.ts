import { ageDisplay } from './format';

describe('ageDisplay (the display rule of Step 2.1a)', () => {
  const at = (years: number, months: number, days: number, estimated = false) =>
    ageDisplay({ age: { years, months, days }, ageYears: years, dobIsEstimated: estimated });

  it('26 y for an adult, 2 y 3 m for a small child, 5 m 12 d for a baby, days for a newborn', () => {
    expect(at(26, 10, 25)).toBe('26 y');
    expect(at(5, 4, 0)).toBe('5 y');
    expect(at(2, 3, 9)).toBe('2 y 3 m');
    expect(at(1, 0, 4)).toBe('1 y');
    expect(at(0, 5, 12)).toBe('5 m 12 d');
    expect(at(0, 3, 0)).toBe('3 m');
    expect(at(0, 0, 12)).toBe('12 d');
    expect(at(0, 0, 0)).toBe('0 d');
  });

  it('an age that comes from an estimated date of birth starts with ~', () => {
    expect(at(70, 0, 0, true)).toBe('~70 y');
    expect(at(0, 5, 12, true)).toBe('~5 m 12 d');
  });

  it('falls back to the whole years when the parts are missing, and to a dash with no age', () => {
    expect(ageDisplay({ ageYears: 34 })).toBe('34 y');
    expect(ageDisplay({ ageYears: 34, dobIsEstimated: true })).toBe('~34 y');
    expect(ageDisplay({ ageYears: null })).toBe('—');
    expect(ageDisplay({})).toBe('—');
  });
});
