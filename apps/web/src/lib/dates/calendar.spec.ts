import {
  addDays,
  GRID_CELLS,
  isWithin,
  localTodayIso,
  monthGrid,
  parseIsoDay,
  shiftMonth,
  toIsoDay,
  weekdayOrder,
} from './calendar';

describe('parseIsoDay / toIsoDay', () => {
  it('accepts real days and refuses everything else (no rolling over)', () => {
    expect(toIsoDay(parseIsoDay('2026-11-19')!)).toBe('2026-11-19');
    expect(parseIsoDay('2028-02-29')).not.toBeNull();
    for (const bad of ['2027-02-30', '2026-13-01', '2026-11-31', '19-11-2026', '', '2026-1-1']) {
      expect(parseIsoDay(bad)).toBeNull();
    }
  });
});

describe('addDays', () => {
  it('moves across month and year ends and leap days', () => {
    expect(addDays('2026-11-19', 1)).toBe('2026-11-20');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-19', -19)).toBe('2026-10-31');
    expect(addDays('2026-11-19', 30)).toBe('2026-12-19');
  });

  it('refuses a date that is not a day', () => {
    expect(() => addDays('nope', 1)).toThrow();
  });
});

describe('localTodayIso', () => {
  it('uses the local calendar fields (not UTC)', () => {
    expect(localTodayIso(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
    expect(localTodayIso(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});

describe('monthGrid', () => {
  it('always has 42 cells, in order, one day apart', () => {
    const cells = monthGrid(2026, 10, 1);
    expect(cells).toHaveLength(GRID_CELLS);
    for (let i = 1; i < cells.length; i += 1) {
      expect(addDays(cells[i - 1]!.iso, 1)).toBe(cells[i]!.iso);
    }
  });

  it('November 2026 starts on a Sunday: Monday-first shows 26 Oct first, Sunday-first shows 1 Nov', () => {
    expect(monthGrid(2026, 10, 1)[0]).toEqual({ iso: '2026-10-26', day: 26, inMonth: false });
    expect(monthGrid(2026, 10, 0)[0]).toEqual({ iso: '2026-11-01', day: 1, inMonth: true });
  });

  it('marks exactly the days of the month as in the month', () => {
    const cells = monthGrid(2028, 1, 1);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(29);
    expect(cells.find((c) => c.inMonth)?.iso).toBe('2028-02-01');
    expect(cells.filter((c) => c.inMonth).at(-1)?.iso).toBe('2028-02-29');
  });
});

describe('shiftMonth', () => {
  it('rolls the year forwards and backwards', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month0: 5 });
    expect(shiftMonth(2026, 10, -23)).toEqual({ year: 2024, month0: 11 });
  });
});

describe('weekdayOrder / isWithin', () => {
  it('starts the week where asked', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('checks the allowed range, both ends included', () => {
    expect(isWithin('2026-11-19', '2026-11-19', '2026-11-30')).toBe(true);
    expect(isWithin('2026-11-18', '2026-11-19')).toBe(false);
    expect(isWithin('2026-12-01', undefined, '2026-11-30')).toBe(false);
    expect(isWithin('2026-11-25')).toBe(true);
  });
});
