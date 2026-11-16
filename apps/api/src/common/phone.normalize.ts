import { BadRequestException } from '@nestjs/common';

/** Generic client message — never leak which format rule failed. */
export const PHONE_INVALID_MESSAGE = 'Invalid phone number';

/**
 * Normalize Indian mobile numbers to E.164 (+91XXXXXXXXXX).
 * Accepts 10 digits starting 6–9, optional +91 / 91 / 0 prefixes, spaces and dashes.
 */
export function normalizePhoneIN(input: string): string {
  if (typeof input !== 'string') {
    throw new BadRequestException(PHONE_INVALID_MESSAGE);
  }
  const digits = input.replace(/[\s-]/g, '').replace(/^\+/, '');
  let national: string;
  if (/^91\d{10}$/.test(digits)) {
    national = digits.slice(2);
  } else if (/^0\d{10}$/.test(digits)) {
    national = digits.slice(1);
  } else if (/^\d{10}$/.test(digits)) {
    national = digits;
  } else {
    throw new BadRequestException(PHONE_INVALID_MESSAGE);
  }
  if (!/^[6-9]\d{9}$/.test(national)) {
    throw new BadRequestException(PHONE_INVALID_MESSAGE);
  }
  return `+91${national}`;
}

/** Mask E.164 for logs/responses: +91XXXXXX1234 */
export function maskPhoneE164(phoneE164: string): string {
  if (!/^\+91\d{10}$/.test(phoneE164)) {
    return '+91XXXXXXXXXX';
  }
  return `+91XXXXXX${phoneE164.slice(-4)}`;
}
