/**
 * @jest-environment node
 */
import { BadRequestException } from '@nestjs/common';
import { maskPhoneE164, normalizePhoneIN } from './phone.normalize';

describe('normalizePhoneIN', () => {
  it('accepts 10-digit, +91, 91, and 0 prefixes with spaces/dashes', () => {
    expect(normalizePhoneIN('9876543210')).toBe('+919876543210');
    expect(normalizePhoneIN('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhoneIN('91-9876543210')).toBe('+919876543210');
    expect(normalizePhoneIN('09876543210')).toBe('+919876543210');
  });

  it('rejects invalid inputs with a generic 400', () => {
    const bad = ['', '123', '5876543210', 'abcdefghij', '+1 9876543210', '91987654321'];
    for (const input of bad) {
      expect(() => normalizePhoneIN(input)).toThrow(BadRequestException);
    }
  });

  it('masks E.164 for responses/logs', () => {
    expect(maskPhoneE164('+919876543210')).toBe('+91XXXXXX3210');
  });
});
