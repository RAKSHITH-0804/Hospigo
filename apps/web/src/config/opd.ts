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
  /** Doctor / nurse queue: seconds between automatic refreshes (0 turns them off). */
  queueRefreshSeconds: number;
  /** Consultation note: seconds after the last keystroke before the draft is saved. */
  autosaveSeconds: number;
  /** Prescription medicine search: characters before searching, wait after typing, hits shown. */
  medicineSearchMinChars: number;
  medicineSearchDebounceMs: number;
  medicineSearchLimit: number;
  /** Earlier completed visits listed on the consultation screen. */
  previousVisitsLimit: number;
  /** Calendar: first day of the week (0 = Sunday ... 6 = Saturday). */
  calendarWeekStart: number;
  /** Follow-up date quick picks, in days from today. */
  followUpQuickDays: readonly number[];
  /** Tests box: characters before searching, wait after typing, hits shown. */
  testsSearchMinChars: number;
  testsSearchDebounceMs: number;
  testsSearchLimit: number;
  /** Reception "Tests to bill": seconds between automatic refreshes (0 turns them off). */
  pendingRefreshSeconds: number;
  /** Refund requests per page, and the query parameter of the page. */
  refundsPageSize: number;
  refundsPageParam: string;
};

const DEFAULTS = {
  receiptPaperSize: 'A5',
  receiptPageMargin: '0',
  visitsPageSize: 10,
  visitsPageParam: 'vp',
  queueRefreshSeconds: 20,
  autosaveSeconds: 5,
  medicineSearchMinChars: 2,
  medicineSearchDebounceMs: 300,
  medicineSearchLimit: 10,
  previousVisitsLimit: 5,
  calendarWeekStart: 1,
  followUpQuickDays: [1, 3, 7, 14, 30],
  testsSearchMinChars: 2,
  testsSearchDebounceMs: 300,
  testsSearchLimit: 10,
  pendingRefreshSeconds: 20,
  refundsPageSize: 20,
  refundsPageParam: 'rp',
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
    queueRefreshSeconds: intEnv(
      env,
      'WEB_OPD_QUEUE_REFRESH_SECONDS',
      DEFAULTS.queueRefreshSeconds,
      0,
      600,
    ),
    autosaveSeconds: intEnv(env, 'WEB_OPD_AUTOSAVE_SECONDS', DEFAULTS.autosaveSeconds, 1, 60),
    medicineSearchMinChars: DEFAULTS.medicineSearchMinChars,
    medicineSearchDebounceMs: DEFAULTS.medicineSearchDebounceMs,
    medicineSearchLimit: DEFAULTS.medicineSearchLimit,
    previousVisitsLimit: intEnv(
      env,
      'WEB_OPD_PREVIOUS_VISITS_LIMIT',
      DEFAULTS.previousVisitsLimit,
      1,
      20,
    ),
    calendarWeekStart: intEnv(env, 'WEB_CALENDAR_WEEK_START', DEFAULTS.calendarWeekStart, 0, 6),
    followUpQuickDays: DEFAULTS.followUpQuickDays,
    testsSearchMinChars: DEFAULTS.testsSearchMinChars,
    testsSearchDebounceMs: DEFAULTS.testsSearchDebounceMs,
    testsSearchLimit: DEFAULTS.testsSearchLimit,
    pendingRefreshSeconds: intEnv(
      env,
      'WEB_OPD_PENDING_REFRESH_SECONDS',
      DEFAULTS.pendingRefreshSeconds,
      0,
      600,
    ),
    refundsPageSize: intEnv(
      env,
      'WEB_OPD_REFUNDS_PAGE_SIZE',
      DEFAULTS.refundsPageSize,
      VISITS_PAGE_SIZE_MIN,
      VISITS_PAGE_SIZE_MAX,
    ),
    refundsPageParam: DEFAULTS.refundsPageParam,
  };
}

export const opdWebConfig = loadOpdWebConfig();
