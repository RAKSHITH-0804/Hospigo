const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/** A date from the address bar: only a real calendar day in YYYY-MM-DD form is accepted. */
export function parseReportDate(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !DATE_PARAM.test(value)) {
    return null;
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  const real =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d;
  return real ? value : null;
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** A calendar day moved by whole days (calendar arithmetic in UTC: no daylight-saving surprises). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(y!, m! - 1, d! + days));
  return moved.toISOString().slice(0, 10);
}

/** The value that means every branch. */
export const ALL_BRANCHES = 'ALL';

/** The filters, as the API names them. Each one narrows the whole report to one value. */
export const FILTER_KEYS = ['doctor', 'paymentMode', 'department', 'billType', 'test'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type ReportQuery = {
  date: string;
  /** null: the branch the person works in; ALL_BRANCHES; or the id of one branch. */
  branch: string | null;
  filters: Partial<Record<FilterKey, string>>;
};

const MAX_VALUE_LENGTH = 100;
/** A value with no control characters (a line break, a NUL byte) in it. */
function hasNoControlCharacters(text: string): boolean {
  return [...text].every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f;
  });
}
const BRANCH_ID = /^[A-Za-z0-9_-]{1,64}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function cleanValue(value: string | string[] | undefined): string | undefined {
  const text = first(value)?.trim();
  return text && text.length <= MAX_VALUE_LENGTH && hasNoControlCharacters(text) ? text : undefined;
}

/**
 * What the address bar asks for. A date that is not a real day becomes `fallbackDate`; a branch that
 * is neither ALL nor shaped like an id is dropped; a filter with an odd value is dropped. Whether a
 * value really exists is the API's to say (it answers 400 for an unknown one).
 */
export function parseReportQuery(
  params: Record<string, string | string[] | undefined>,
  fallbackDate: string,
): ReportQuery {
  const branchRaw = first(params.branch)?.trim();
  const filters: ReportQuery['filters'] = {};
  for (const key of FILTER_KEYS) {
    const value = cleanValue(params[key]);
    if (value) {
      filters[key] = value;
    }
  }
  return {
    date: parseReportDate(params.date) ?? fallbackDate,
    branch: branchRaw && BRANCH_ID.test(branchRaw) ? branchRaw : null,
    filters,
  };
}

/** The same query as address-bar and API parameters (only what is set). */
export function queryParams(query: ReportQuery): URLSearchParams {
  const params = new URLSearchParams({ date: query.date });
  if (query.branch) {
    params.set('branch', query.branch);
  }
  for (const key of FILTER_KEYS) {
    const value = query.filters[key];
    if (value) {
      params.set(key, value);
    }
  }
  return params;
}

export function reportHref(query: ReportQuery): string {
  return `/app/opd/reports?${queryParams(query).toString()}`;
}

export type ReportFileKind = 'csv' | 'xlsx';

/** The download of the same report (a route handler of this app; the API checks the permission). */
export function reportFileHref(kind: ReportFileKind, query: ReportQuery): string {
  return `/api/staff/opd/reports/daily-collection.${kind}?${queryParams(query).toString()}`;
}

/** The file name the browser saves (the same as the API's own Content-Disposition). */
export function reportFileName(date: string, branch: string | null, kind: ReportFileKind): string {
  return `collection-${date}${branch === ALL_BRANCHES ? '-all' : ''}.${kind}`;
}

/** How many filters are set (the branch is a choice of place, not a filter). */
export function activeFilterCount(query: ReportQuery): number {
  return FILTER_KEYS.filter((key) => query.filters[key]).length;
}
