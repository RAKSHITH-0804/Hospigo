/**
 * Money display. The API and the database use whole paise (integers) only; this is the one place
 * that turns paise into text, with integer arithmetic (never floating point on money).
 * No env: it is used by server AND browser components (browsers cannot read WEB_* variables).
 */
export const moneyConfig = {
  currency: 'INR',
  locale: 'en-IN',
  /** Paise per rupee (the minor unit of the currency). */
  minorPerMajor: 100,
  fractionDigits: 2,
} as const;

let symbolCache: string | undefined;
let decimalCache: string | undefined;

function currencySymbol(): string {
  if (symbolCache === undefined) {
    const parts = new Intl.NumberFormat(moneyConfig.locale, {
      style: 'currency',
      currency: moneyConfig.currency,
    }).formatToParts(0);
    symbolCache = parts.find((p) => p.type === 'currency')?.value ?? moneyConfig.currency;
  }
  return symbolCache;
}

function decimalSeparator(): string {
  if (decimalCache === undefined) {
    const parts = new Intl.NumberFormat(moneyConfig.locale).formatToParts(1.1);
    decimalCache = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  }
  return decimalCache;
}

/**
 * 60000 -> "₹600.00", 11000000 -> "₹1,10,000.00", 5 -> "₹0.05", -250 -> "-₹2.50".
 * Throws for anything that is not a whole number of paise: a fractional or missing amount must
 * never be shown as if it were money.
 */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error('Money must be a whole number of paise');
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  // Exact integer split: abs - abs % 100 is a multiple of 100, so the division is exact.
  const minor = abs % moneyConfig.minorPerMajor;
  const major = (abs - minor) / moneyConfig.minorPerMajor;
  const grouped = new Intl.NumberFormat(moneyConfig.locale).format(major);
  const fraction = String(minor).padStart(moneyConfig.fractionDigits, '0');
  return `${negative ? '-' : ''}${currencySymbol()}${grouped}${decimalSeparator()}${fraction}`;
}

/** Rupees as typed ("300", "300.5", "300.50") to whole paise; null for anything else. */
const RUPEES_TEXT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

export function parseRupeesToPaise(text: string): number | null {
  const match = RUPEES_TEXT.exec(text.trim());
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number((match[2] ?? '').padEnd(moneyConfig.fractionDigits, '0'));
  return major * moneyConfig.minorPerMajor + minor;
}

/** 60000 -> "600.00" (plain digits for an input box; no symbol, no grouping). */
export function paiseToRupeesText(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error('Money must be a whole, non-negative number of paise');
  }
  const minor = paise % moneyConfig.minorPerMajor;
  const major = (paise - minor) / moneyConfig.minorPerMajor;
  return `${major}.${String(minor).padStart(moneyConfig.fractionDigits, '0')}`;
}
