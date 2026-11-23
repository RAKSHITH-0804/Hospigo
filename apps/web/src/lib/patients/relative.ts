import type { CustomFieldValue, FormConfigField } from './types';

/** The section of a patient field that holds the relative's details (title, relation, name). */
export const RELATIVE_SECTION = 'RELATIVE';

function shown(value: CustomFieldValue): string {
  const raw = value.optionLabel ?? value.valueText ?? value.valueDate ?? value.valueNumber;
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

/**
 * What the registration slip prints for "relative": the values of the patient's custom fields whose
 * field definition is in the RELATIVE section, in the hospital's own order (sort order), joined with
 * a space, for example "S/O Ravi Kumar". Nothing is named in code: the hospital decides which
 * fields sit in the section. Fields without a value are left out.
 */
export function relativeLine(
  values: readonly CustomFieldValue[] | undefined,
  fields: readonly FormConfigField[],
): string {
  const byCode = new Map((values ?? []).map((v) => [v.code, v]));
  return fields
    .filter((f) => f.section === RELATIVE_SECTION)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => {
      const code = f.code ?? f.key;
      const value = code ? byCode.get(code) : undefined;
      return value ? shown(value) : '';
    })
    .filter((text) => text.length > 0)
    .join(' ');
}
