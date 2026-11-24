import { financialYearLabel, financialYearStart, previewNumber } from './number-preview';

describe('number preview', () => {
  it('the financial year starts in the chosen month: before it, the year before counts', () => {
    expect(financialYearStart('2026-11-24', 4)).toBe(2026);
    expect(financialYearStart('2026-03-31', 4)).toBe(2025);
    expect(financialYearStart('2026-04-01', 4)).toBe(2026);
    expect(financialYearStart('2026-01-05', 1)).toBe(2026);
  });

  it('the short and the long year', () => {
    expect(financialYearLabel(2026, 'SHORT')).toBe('2627');
    expect(financialYearLabel(2026, 'LONG')).toBe('2026-27');
    expect(financialYearLabel(2099, 'SHORT')).toBe('9900');
  });

  it('prefix, year, separator and the number with zeros in front; a longer number is never cut', () => {
    const base = {
      prefix: 'B',
      fyStyle: 'SHORT' as const,
      separator: '/',
      width: 5,
      today: '2026-11-24',
      fyStartMonth: 4,
    };
    expect(previewNumber({ ...base, running: BigInt(42) })).toBe('B2627/00042');
    expect(previewNumber({ ...base, running: BigInt(123456) })).toBe('B2627/123456');
    expect(
      previewNumber({
        ...base,
        prefix: '',
        separator: '',
        fyStyle: 'LONG',
        width: 3,
        running: BigInt(1),
      }),
    ).toBe('2026-27001');
  });
});
