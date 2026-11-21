import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.settings.settingsErrors;

/**
 * The calm sentence for a refused settings change. The API says WHICH field and WHY
 * (`blocks.2.textValue`, `TOO_LONG`); this names the part or choice by its number and never shows
 * upstream text.
 */
export function settingsErrorMessage(error: PatientsApiError): string {
  if (error.status === 404 && error.code === 'SETTINGS_NOT_FOUND') {
    return copy.notFound;
  }
  if (error.status !== 400 || error.code !== 'SETTINGS_INVALID') {
    return errorMessageFor(error.code);
  }
  const reason = error.reason ? copy.reasons[error.reason] : undefined;
  const parts = (error.field ?? '').split('.');
  const index = parts.find((p) => /^\d+$/.test(p));
  const name = [...parts].reverse().find((p) => !/^\d+$/.test(p));
  const fieldText = name ? copy.fields[name] : undefined;
  if (!reason || !fieldText) {
    return copy.fallback;
  }
  const where =
    index === undefined
      ? ''
      : ` (${(parts[0] === 'options' ? copy.choice : copy.part).replace('{n}', String(Number(index) + 1))})`;
  return `${copy.prefix} ${fieldText}${where} ${reason}`;
}
