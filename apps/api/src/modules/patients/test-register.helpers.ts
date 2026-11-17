/**
 * Shared test helper: unique valid Indian mobile (+ age/DOB) for registration fixtures.
 * Use whenever a test registers a patient so phone/age-or-DOB always-required rules pass.
 */

let phoneSeq = Math.floor(Date.now() % 80_000_000);

/** 10-digit mobile starting with 9 (normalises to +919…). */
export function uniqueValidTestPhone(): string {
  phoneSeq = (phoneSeq + 1) % 80_000_000;
  return `9${String(phoneSeq).padStart(9, '0')}`;
}

export type TestRegisterIdentity = {
  name: string;
  ageYears: number;
  phone: string;
};

/** Minimal always-required identity fields; override name/age/phone as needed. */
export function testRegisterIdentity(
  overrides: Partial<TestRegisterIdentity> & { name?: string } = {},
): TestRegisterIdentity {
  return {
    name: overrides.name ?? 'Test Patient',
    ageYears: overrides.ageYears ?? 30,
    phone: overrides.phone ?? uniqueValidTestPhone(),
  };
}
