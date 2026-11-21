import { staffCopy } from '@/config/staff-copy';
import type { PatientsApiError } from '@/lib/patients/client';
import { settingsErrorMessage } from './errors';
import type { UhidBlock } from './types';
import { previewUhid } from './uhid-preview';

const copy = staffCopy.settings.settingsErrors;
const refusal = (over: Partial<PatientsApiError>): PatientsApiError => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  ...over,
});

describe('settingsErrorMessage', () => {
  it('names the field and the reason in plain words', () => {
    expect(
      settingsErrorMessage(refusal({ field: 'followUpFreeDays', reason: 'OUT_OF_RANGE' })),
    ).toBe(`${copy.prefix} ${copy.fields.followUpFreeDays} ${copy.reasons.OUT_OF_RANGE}`);
  });

  it('names a part or a choice by its number (counted from 1)', () => {
    expect(settingsErrorMessage(refusal({ field: 'blocks.2.textValue', reason: 'TOO_LONG' }))).toBe(
      `${copy.prefix} ${copy.fields.textValue} (piece 3) ${copy.reasons.TOO_LONG}`,
    );
    expect(settingsErrorMessage(refusal({ field: 'options.0.label', reason: 'REQUIRED' }))).toBe(
      `${copy.prefix} ${copy.fields.label} (choice 1) ${copy.reasons.REQUIRED}`,
    );
  });

  it('falls back calmly when the field or the reason is not known, and never shows upstream text', () => {
    expect(settingsErrorMessage(refusal({ field: 'mystery', reason: 'OUT_OF_RANGE' }))).toBe(
      copy.fallback,
    );
    expect(settingsErrorMessage(refusal({ field: 'label', reason: 'WEIRD' }))).toBe(copy.fallback);
    expect(settingsErrorMessage(refusal({}))).toBe(copy.fallback);
  });

  it('names a doctor profile field and says only an Admin can change the department', () => {
    expect(settingsErrorMessage(refusal({ field: 'registrationNo', reason: 'INVALID' }))).toBe(
      `${copy.prefix} ${copy.fields.registrationNo} ${copy.reasons.INVALID}`,
    );
    expect(settingsErrorMessage(refusal({ field: 'department', reason: 'NOT_ALLOWED' }))).toBe(
      `${copy.prefix} ${copy.fields.department} ${copy.reasons.NOT_ALLOWED}`,
    );
  });

  it('uses the usual messages for other failures', () => {
    expect(settingsErrorMessage(refusal({ status: 403, code: 'FORBIDDEN' }))).toBe(
      staffCopy.errors.forbidden,
    );
    expect(settingsErrorMessage(refusal({ status: 404, code: 'SETTINGS_NOT_FOUND' }))).toBe(
      copy.notFound,
    );
    expect(settingsErrorMessage(refusal({ status: 500, code: 'UNKNOWN' }))).toBe(
      staffCopy.errors.tryAgain,
    );
  });
});

describe('previewUhid', () => {
  const block = (over: Partial<UhidBlock>): UhidBlock => ({
    blockType: 'FIXED_TEXT',
    textValue: null,
    fyStyle: null,
    minWidth: null,
    ...over,
  });
  const base = {
    resetRule: 'NEVER' as const,
    fyStartMonth: 4,
    branchCode: 'MAIN',
    runningNumber: 7,
  };

  it('joins the parts in order and pads the running number', () => {
    const blocks = [
      block({ textValue: 'UH' }),
      block({ blockType: 'SEPARATOR', textValue: '-' }),
      block({ blockType: 'BRANCH_CODE' }),
      block({ blockType: 'SEPARATOR', textValue: '/' }),
      block({ blockType: 'RUNNING_NUMBER', minWidth: 5 }),
    ];
    expect(previewUhid({ ...base, blocks, now: new Date(2026, 10, 21) })).toBe('UH-MAIN/00007');
  });

  it('builds the financial year in both styles, switching at the start month', () => {
    const short = [block({ blockType: 'FINANCIAL_YEAR', fyStyle: 'SHORT' })];
    const long = [block({ blockType: 'FINANCIAL_YEAR', fyStyle: 'LONG' })];
    expect(previewUhid({ ...base, blocks: short, now: new Date(2026, 10, 21) })).toBe('2627');
    expect(previewUhid({ ...base, blocks: long, now: new Date(2026, 10, 21) })).toBe('2026-27');
    // before April it is still the year that began last April
    expect(previewUhid({ ...base, blocks: long, now: new Date(2026, 2, 31) })).toBe('2025-26');
    expect(previewUhid({ ...base, fyStartMonth: 1, blocks: long, now: new Date(2026, 0, 1) })).toBe(
      '2026-27',
    );
  });

  it('builds the calendar year, and a number wider than the digits is not cut', () => {
    const blocks = [
      block({ blockType: 'CALENDAR_YEAR' }),
      block({ blockType: 'RUNNING_NUMBER', minWidth: 2 }),
    ];
    expect(previewUhid({ ...base, blocks, runningNumber: 12345, now: new Date(2026, 5, 1) })).toBe(
      '202612345',
    );
  });
});
