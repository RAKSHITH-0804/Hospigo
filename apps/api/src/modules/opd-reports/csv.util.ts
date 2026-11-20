/**
 * CSV helpers. Two safety rules:
 *  - a text cell that starts with = + - @ (or a tab or carriage return) could be run as a formula
 *    by Excel or Sheets, so it is prefixed with an apostrophe: a name can never become a formula;
 *  - a cell with a comma, quote or line break is quoted and its quotes doubled.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain number such as 12 or -200.00 (an optional minus, digits, an optional decimal part). */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  // A real negative amount must stay a number; anything else that starts like a formula is text.
  if (typeof value === 'string' && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',');
}

/**
 * Whole paise as rupees with two decimals ("-250" -> "-2.50"). Integer arithmetic only: a
 * fractional or unsafe amount throws instead of being written as if it were money.
 */
export function paiseToRupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error('Money must be a whole number of paise');
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const minor = abs % 100;
  const major = (abs - minor) / 100;
  return `${negative ? '-' : ''}${major}.${String(minor).padStart(2, '0')}`;
}
