import { staffCopy } from '@/config/staff-copy';
import type { PatientsApiError } from '@/lib/patients/client';
import { staffErrorMessage } from './errors';

const copy = staffCopy.staffAdmin.errors;
const settings = staffCopy.settings.settingsErrors;
const refusal = (over: Partial<PatientsApiError>): PatientsApiError => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  ...over,
});

describe('staffErrorMessage', () => {
  it.each(Object.keys(copy.conflicts))('names the conflict %s in plain words', (reason) => {
    expect(staffErrorMessage(refusal({ status: 409, code: 'STAFF_CONFLICT', reason }))).toBe(
      copy.conflicts[reason],
    );
  });

  it('every conflict the API can give has a sentence of its own', () => {
    for (const reason of [
      'SELF',
      'LAST_SUPER_ADMIN',
      'ROLE_IN_USE',
      'SYSTEM_ROLE',
      'ALREADY_ACTIVE',
      'INACTIVE',
      'TRY_AGAIN',
    ]) {
      expect(copy.conflicts[reason]).toBeTruthy();
    }
    expect(staffErrorMessage(refusal({ status: 409, code: 'STAFF_CONFLICT', reason: 'NEW' }))).toBe(
      copy.conflictFallback,
    );
    expect(staffErrorMessage(refusal({ status: 409, code: 'STAFF_CONFLICT' }))).toBe(
      copy.conflictFallback,
    );
  });

  it('tells how many seconds to wait after too many requests', () => {
    expect(
      staffErrorMessage(refusal({ status: 429, code: 'RATE_LIMITED', retryAfterSec: 42 })),
    ).toBe(copy.rateLimited.replace('{seconds}', '42'));
  });

  it.each(['EXPIRED', 'WRONG_CODE', 'TOO_MANY_TRIES'])('explains the code problem %s', (reason) => {
    expect(staffErrorMessage(refusal({ code: 'OTP_INVALID', reason }))).toBe(copy.codes[reason]);
  });

  it('a code problem the web does not know gets the general sentence', () => {
    expect(staffErrorMessage(refusal({ code: 'OTP_INVALID', reason: 'NEW' }))).toBe(
      copy.codeFallback,
    );
  });

  it('names the field and reason for the staff, role and password fields', () => {
    const f = settings.fields;
    const r = settings.reasons;
    for (const [field, reason] of [
      ['email', 'DUPLICATE'],
      ['email', 'SAME'],
      ['email', 'MISMATCH'],
      ['name', 'TOO_LONG'],
      ['phone', 'INVALID'],
      ['roles.1.roleId', 'NOT_ALLOWED'],
      ['branchIds.0', 'NOT_ALLOWED'],
      ['permissionCodes', 'REQUIRED'],
      ['prefix', 'INVALID'],
      ['newPassword', 'TOO_SHORT'],
      ['newPassword', 'COMMON_PASSWORD'],
      ['code', 'INVALID'],
    ] as const) {
      const name = field
        .split('.')
        .filter((p) => !/^\d+$/.test(p))
        .at(-1)!;
      expect(f[name]).toBeTruthy();
      expect(r[reason]).toBeTruthy();
      expect(staffErrorMessage(refusal({ field, reason }))).toContain(`${f[name]}`);
    }
  });

  it('uses the usual messages for other failures and never shows upstream text', () => {
    expect(staffErrorMessage(refusal({ status: 403, code: 'FORBIDDEN' }))).toBe(
      staffCopy.errors.forbidden,
    );
    expect(staffErrorMessage(refusal({ status: 0, code: 'UNAVAILABLE' }))).toBe(
      staffCopy.errors.unreachable,
    );
    expect(staffErrorMessage(refusal({ status: 404, code: 'SETTINGS_NOT_FOUND' }))).toBe(
      settings.notFound,
    );
    expect(staffErrorMessage(refusal({ status: 500, code: 'UNKNOWN' }))).toBe(
      staffCopy.errors.tryAgain,
    );
  });
});

describe('the picture help texts', () => {
  it('the Logo page has help with the real button names, and the doctor help mentions the picture', () => {
    const pages = staffCopy.settings.help.pages;
    const logo = pages.branding!;
    expect(logo.steps.length).toBeGreaterThanOrEqual(2);
    expect(logo.steps.join(' ')).toContain(staffCopy.pictures.picker.choose);
    expect(logo.steps.join(' ')).toContain(staffCopy.pictures.picker.replace);
    expect(logo.steps.join(' ')).toContain(staffCopy.pictures.picker.remove);
    expect(logo.steps.join(' ')).toContain(staffCopy.settings.printing.addLogo.replace(' box', ''));
    expect(pages['doctor-profile']!.steps.join(' ')).toContain(staffCopy.pictures.picker.choose);
    expect(pages['doctor-profile']!.steps.join(' ')).toContain(staffCopy.pictures.signature.title);
    expect(pages.doctors!.steps.join(' ')).toContain(staffCopy.pictures.picker.choose);
  });
});

describe('the staff help texts', () => {
  const pages = staffCopy.settings.help.pages;
  it('Staff, Roles and My profile have help with the real button names', () => {
    const staff = pages.staff!;
    const roles = pages.roles!;
    const account = pages.account!;
    for (const page of [staff, roles, account]) {
      expect(page.steps.length).toBeGreaterThanOrEqual(2);
      expect(page.good.length).toBeGreaterThanOrEqual(2);
    }
    const s = staffCopy.staffAdmin.staff;
    expect(staff.steps.join(' ')).toContain(s.add);
    expect(staff.steps.join(' ')).toContain(s.form.addSubmit);
    expect(staff.steps.join(' ')).toContain(s.edit);
    expect(staff.steps.join(' ')).toContain(s.actions.switchOff);
    expect(staff.steps.join(' ')).toContain(s.actions.resend);
    const r = staffCopy.staffAdmin.roles;
    expect(roles.steps.join(' ')).toContain(r.add);
    expect(roles.steps.join(' ')).toContain(r.form.template);
    expect(roles.steps.join(' ')).toContain(r.form.powersHeading);
    expect(roles.steps.join(' ')).toContain(r.form.save);
    const a = staffCopy.account;
    expect(account.steps.join(' ')).toContain(a.details.save);
    expect(account.steps.join(' ')).toContain(a.email.sendCode);
    expect(account.steps.join(' ')).toContain(a.email.confirm);
    expect(account.steps.join(' ')).toContain(a.password.change);
  });
});
