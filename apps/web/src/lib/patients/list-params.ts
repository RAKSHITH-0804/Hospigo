import {
  columnForSort,
  directionForSort,
  isPatientListSort,
  isPatientListSortColumn,
  patientsWebConfig,
  type PatientListSort,
  type PatientListSortColumn,
} from '@/config/patients';

/** The state of the patients list as it lives in the URL (?q, sort, col, page). */
export type PatientListParams = {
  q: string;
  sort: PatientListSort;
  col: PatientListSortColumn;
  page: number;
};

type Raw = string | string[] | undefined | null;

function first(raw: Raw): string | undefined {
  return Array.isArray(raw) ? raw[0] : (raw ?? undefined);
}

/** Parse URL values (server searchParams or client URLSearchParams) into safe list params. */
export function parseListParams(
  raw: { q?: Raw; sort?: Raw; col?: Raw; page?: Raw },
  config: { searchMaxLength: number; listSortDefault: PatientListSort } = patientsWebConfig,
): PatientListParams {
  const q = (first(raw.q) ?? '').trim().slice(0, config.searchMaxLength);
  const sortRaw = first(raw.sort);
  const colRaw = first(raw.col);
  const pageNumber = Number(first(raw.page));
  const sort = sortRaw && isPatientListSort(sortRaw) ? sortRaw : config.listSortDefault;
  // `col` only marks the active header: it must agree with `sort`, otherwise derive it.
  const col =
    colRaw && isPatientListSortColumn(colRaw) && directionForSort(colRaw, sort) !== null
      ? colRaw
      : columnForSort(sort);
  return {
    q,
    sort,
    col,
    page: Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1,
  };
}

/** True when the text is long enough to be sent as `q`. */
export function isSearchable(q: string, minLength: number): boolean {
  return q.trim().length >= minLength;
}

/** Query string for the page URL (history.replaceState and links). */
export function listUrlQuery(params: PatientListParams): string {
  const search = new URLSearchParams();
  search.set('sort', params.sort);
  search.set('col', params.col);
  if (params.page > 1) {
    search.set('page', String(params.page));
  }
  if (params.q) {
    search.set('q', params.q);
  }
  return search.toString();
}
