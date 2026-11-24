/**
 * Step 8c: the ready-made set of "reference" fields a hospital usually wants on the registration
 * form (who referred the patient, the patient's category, the organisation, the staff number). They
 * are ordinary custom fields (Step 7b): the Admin adds the set in one click, can rename, move, make
 * required or switch off each of them afterwards, and answers are never deleted. Nothing here
 * overwrites a field that exists: a field whose name is already used is left as it is.
 */

export type ReferenceFieldDefinition = {
  label: string;
  dataType: 'TEXT' | 'DROPDOWN';
  section: 'OTHER';
  options?: readonly string[];
};

export const REFERENCE_FIELD_SET: readonly ReferenceFieldDefinition[] = [
  { label: 'Referred by', dataType: 'TEXT', section: 'OTHER' },
  {
    label: 'Category',
    dataType: 'DROPDOWN',
    section: 'OTHER',
    options: ['General', 'Staff', 'Insurance', 'Senior citizen'],
  },
  { label: 'Organisation', dataType: 'TEXT', section: 'OTHER' },
  { label: 'Staff number', dataType: 'TEXT', section: 'OTHER' },
];

/** The longest code of a custom field (`cf_` + a slug). */
export const CUSTOM_FIELD_CODE_MAX = 40;

/** `cf_` plus the label in lower case letters, digits and underscores. */
export function codeFromLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `cf_${slug || 'field'}`.slice(0, CUSTOM_FIELD_CODE_MAX - 4);
}
