/**
 * @jest-environment node
 */
import { formatPaise } from './money';

describe('formatPaise (whole paise only, integer arithmetic)', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [99, '₹0.99'],
    [100, '₹1.00'],
    [1999, '₹19.99'],
    [60_000, '₹600.00'],
    [123_456, '₹1,234.56'],
    [11_000_000, '₹1,10,000.00'],
    [2_147_483_647, '₹2,14,74,836.47'],
    [-250, '-₹2.50'],
    [-5, '-₹0.05'],
  ])('%i paise -> %s', (paise, text) => {
    expect(formatPaise(paise)).toBe(text);
  });

  it('never rounds or drifts: matches exact integer arithmetic for many amounts', () => {
    for (let paise = 0; paise < 250_000; paise += 137) {
      const rupees = BigInt(Math.floor(paise / 100));
      const rest = String(paise % 100).padStart(2, '0');
      const shown = formatPaise(paise);
      expect(shown.endsWith(`.${rest}`)).toBe(true);
      expect(shown.replace(/[^0-9]/g, '')).toBe(`${rupees}${rest}`);
    }
  });

  it.each([1.5, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    'refuses %p (not a whole number of paise)',
    (value) => {
      expect(() => formatPaise(value)).toThrow(/whole number of paise/);
    },
  );

  it('refuses a value that is not a number at all', () => {
    expect(() => formatPaise('600' as unknown as number)).toThrow();
    expect(() => formatPaise(undefined as unknown as number)).toThrow();
    expect(() => formatPaise(null as unknown as number)).toThrow();
  });
});
