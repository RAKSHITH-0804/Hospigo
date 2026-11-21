/**
 * The sections of the collection report a person can choose (the tables of the screen and the
 * parts of the CSV and Excel files). The report itself is always the same; the choice only decides
 * what is shown or written.
 */
export const REPORT_SECTIONS = [
  'MODE',
  'DOCTOR',
  'DEPARTMENT',
  'BILL_TYPE',
  'TEST',
  'BRANCH',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** Pattern for the `sections` query value: known names separated by commas. */
export const REPORT_SECTIONS_PATTERN = new RegExp(
  `^(${REPORT_SECTIONS.join('|')})(,(${REPORT_SECTIONS.join('|')}))*$`,
);

/**
 * The sections asked for, once each, in the report's own order. Nothing asked for (or no value)
 * means every section.
 */
export function parseSections(raw: string | undefined): ReportSection[] {
  if (!raw) {
    return [...REPORT_SECTIONS];
  }
  const asked = new Set(raw.split(','));
  return REPORT_SECTIONS.filter((section) => asked.has(section));
}
