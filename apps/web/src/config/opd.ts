/**
 * OPD reception screens: paper, page size and list sizes (server side only; a browser cannot
 * read WEB_* variables). Print layouts become hospital settings in Step 7.
 */
export type OpdWebConfig = {
  /** CSS @page size keyword for the receipt. */
  receiptPaperSize: string;
  /** CSS @page margin (0 hides the browser's own date/URL header and footer). */
  receiptPageMargin: string;
  /** Visits per page on the patient record. */
  visitsPageSize: number;
  /** Query parameter for the visits / bills page on the patient record. */
  visitsPageParam: string;
};

const DEFAULTS = {
  receiptPaperSize: 'A5',
  receiptPageMargin: '0',
  visitsPageSize: 10,
  visitsPageParam: 'vp',
} as const;

const VISITS_PAGE_SIZE_MIN = 1;
const VISITS_PAGE_SIZE_MAX = 100;

function strEnv(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function intEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer ${min}..${max}`);
  }
  return n;
}

export function loadOpdWebConfig(
  env: Record<string, string | undefined> = process.env,
): OpdWebConfig {
  return {
    receiptPaperSize: strEnv(env, 'WEB_RECEIPT_PAPER_SIZE', DEFAULTS.receiptPaperSize),
    receiptPageMargin: strEnv(env, 'WEB_RECEIPT_PAGE_MARGIN', DEFAULTS.receiptPageMargin),
    visitsPageSize: intEnv(
      env,
      'WEB_OPD_VISITS_PAGE_SIZE',
      DEFAULTS.visitsPageSize,
      VISITS_PAGE_SIZE_MIN,
      VISITS_PAGE_SIZE_MAX,
    ),
    visitsPageParam: DEFAULTS.visitsPageParam,
  };
}

export const opdWebConfig = loadOpdWebConfig();
