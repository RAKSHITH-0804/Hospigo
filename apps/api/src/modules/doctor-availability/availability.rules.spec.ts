import {
  AvailabilityRuleError,
  leavesOverlap,
  parseLeave,
  parseSwitch,
  parseTimings,
} from './availability.rules';

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AvailabilityRuleError) {
      return error.reason;
    }
    throw error;
  }
  return 'NO_ERROR';
};

describe('availability rules', () => {
  it('parseSwitch takes only a real boolean', () => {
    expect(parseSwitch({ availabilityOn: false })).toEqual({ availabilityOn: false });
    expect(reasonOf(() => parseSwitch({ availabilityOn: 'true' }))).toBe('NOT_A_BOOLEAN');
    expect(reasonOf(() => parseSwitch(null))).toBe('REQUIRED');
    expect(reasonOf(() => parseSwitch({ availabilityOn: true, x: 1 }))).toBe('UNKNOWN_FIELD');
  });

  it('parseTimings sorts, accepts touching slots and refuses overlaps', () => {
    expect(
      parseTimings({
        slots: [
          { weekday: 2, start: '13:00', end: '17:00' },
          { weekday: 2, start: '09:00', end: '13:00' },
          { weekday: 0, start: '00:00', end: '23:59' },
        ],
      }),
    ).toEqual([
      { weekday: 0, start: '00:00', end: '23:59' },
      { weekday: 2, start: '09:00', end: '13:00' },
      { weekday: 2, start: '13:00', end: '17:00' },
    ]);
    expect(
      reasonOf(() =>
        parseTimings({
          slots: [
            { weekday: 2, start: '09:00', end: '13:01' },
            { weekday: 2, start: '13:00', end: '17:00' },
          ],
        }),
      ),
    ).toBe('OVERLAP');
    expect(parseTimings({ slots: [] })).toEqual([]);
  });

  it('parseLeave checks order, the past, length and distance in days', () => {
    const today = '2026-11-23';
    expect(parseLeave({ fromDate: '2026-11-23', toDate: '2026-11-23' }, today)).toEqual({
      fromDate: '2026-11-23',
      toDate: '2026-11-23',
    });
    // started earlier but still running today is fine
    expect(parseLeave({ fromDate: '2026-11-20', toDate: '2026-11-24' }, today).toDate).toBe(
      '2026-11-24',
    );
    expect(
      reasonOf(() => parseLeave({ fromDate: '2026-11-22', toDate: '2026-11-22' }, today)),
    ).toBe('DATE_IN_PAST');
    expect(
      reasonOf(() => parseLeave({ fromDate: '2026-12-02', toDate: '2026-12-01' }, today)),
    ).toBe('END_BEFORE_START');
    expect(
      reasonOf(() => parseLeave({ fromDate: '2026-11-23', toDate: '2027-11-24' }, today)),
    ).toBe('TOO_LONG');
    expect(parseLeave({ fromDate: '2026-11-23', toDate: '2027-11-23' }, today).toDate).toBe(
      '2027-11-23',
    ); // 366 days is allowed
  });

  it('leavesOverlap counts the last day', () => {
    const a = { fromDate: '2026-12-01', toDate: '2026-12-05' };
    expect(leavesOverlap(a, { fromDate: '2026-12-05', toDate: '2026-12-06' })).toBe(true);
    expect(leavesOverlap(a, { fromDate: '2026-12-06', toDate: '2026-12-06' })).toBe(false);
    expect(leavesOverlap(a, { fromDate: '2026-11-01', toDate: '2026-12-01' })).toBe(true);
  });
});
