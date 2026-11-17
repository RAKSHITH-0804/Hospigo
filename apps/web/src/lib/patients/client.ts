import { PatientListSort, type PatientListSort as ListSort } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import type { DuplicateMatch, PatientFieldErrorCode } from './types';

/** Next route handlers that proxy the patients API. Browsers never see tokens. */
export const PATIENTS_API = '/api/staff/patients';
export const PATIENTS_FORM_CONFIG_API = `${PATIENTS_API}/form-config`;
export const UHID_START_NUMBER_API = `${PATIENTS_API}/uhid/start-number`;
/** Returned (never shown) when the caller cancelled the request. */
export const ABORTED_CODE = 'ABORTED';
export const AUTH_REFRESH_SESSION_API = '/api/auth/refresh-session';

export type PatientsApiOk<T> = { ok: true; data: T };
export type PatientsApiError = {
  ok: false;
  status: number;
  code: string;
  matches?: DuplicateMatch[];
  fieldErrors?: Record<string, string>;
};
export type PatientsApiResult<T> = PatientsApiOk<T> | PatientsApiError;

export type PatientsApiInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  /** Lets a caller cancel an in-flight request (live search). */
  signal?: AbortSignal;
  /** Internal: already retried once after silent refresh. */
  _retried?: boolean;
};

function readMatches(value: unknown): DuplicateMatch[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: DuplicateMatch[] = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const { id, uhid, name } = item as Record<string, unknown>;
      if (typeof id === 'string' && typeof uhid === 'string' && typeof name === 'string') {
        out.push({ id, uhid, name });
      }
    }
  }
  return out;
}

function readFieldErrors(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(value as Record<string, unknown>)) {
    if (typeof code === 'string') {
      out[key] = code;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Shared in-flight promise so concurrent 401s trigger one refresh. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * POST /api/auth/refresh-session (JSON, no redirect). Cookies only.
 * Concurrent callers share one request.
 */
export function refreshSessionOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(AUTH_REFRESH_SESSION_API, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Test-only: clear the client refresh latch. */
export function clearClientRefreshLatchForTests(): void {
  refreshInFlight = null;
}

async function fetchPatientsOnce<T>(
  path: string,
  init: PatientsApiInit,
): Promise<PatientsApiResult<T>> {
  const hasBody = init.body !== undefined;
  try {
    const response = await fetch(path, {
      method: init.method ?? (hasBody ? 'POST' : 'GET'),
      credentials: 'include',
      cache: 'no-store',
      headers: hasBody
        ? { Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Accept: 'application/json' },
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok) {
      return { ok: true, data: json as T };
    }
    const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    return {
      ok: false,
      status: response.status,
      code: typeof record.code === 'string' ? record.code : 'UNKNOWN',
      matches: readMatches(record.matches),
      fieldErrors: readFieldErrors(record.fieldErrors),
    };
  } catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return { ok: false, status: 0, code: ABORTED_CODE };
    }
    return { ok: false, status: 0, code: 'UNAVAILABLE' };
  }
}

/**
 * Same-origin fetch to a Next staff route. Cookies ride along.
 * On SESSION_EXPIRED 401: one silent refresh + one retry (shared in-flight).
 */
export async function patientsApi<T>(
  path: string,
  init: PatientsApiInit = {},
): Promise<PatientsApiResult<T>> {
  const first = await fetchPatientsOnce<T>(path, init);
  if (
    first.ok ||
    init._retried ||
    first.status !== 401 ||
    (first.code !== 'SESSION_EXPIRED' && first.code !== 'UNAUTHORIZED')
  ) {
    return first;
  }
  const refreshed = await refreshSessionOnce();
  if (!refreshed) {
    return { ...first, code: 'SESSION_EXPIRED' };
  }
  return fetchPatientsOnce<T>(path, { ...init, _retried: true });
}

/** Map a route error code to staffCopy.errors wording. */
export function errorMessageFor(code: string): string {
  switch (code) {
    case 'FORBIDDEN':
      return staffCopy.errors.forbidden;
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
      return staffCopy.errors.sessionExpired;
    case 'UNAVAILABLE':
      return staffCopy.errors.unreachable;
    default:
      return staffCopy.errors.tryAgain;
  }
}

/** Map API fieldErrors codes to form copy (never upstream text). */
export function fieldErrorMessageFor(code: string): string {
  const form = staffCopy.patients.form;
  switch (code as PatientFieldErrorCode) {
    case 'REQUIRED':
      return form.fieldErrorRequired;
    case 'INVALID':
      return form.fieldErrorInvalid;
    case 'AGE_AND_DOB_BOTH':
      return form.fieldErrorAgeAndDobBoth;
    default:
      return form.fieldErrorInvalid;
  }
}

export function buildListPath(args: {
  sort: ListSort | string;
  page: number;
  pageSize: number;
  q?: string;
}): string {
  const params = new URLSearchParams();
  params.set('sort', args.sort || PatientListSort.NEWEST);
  params.set('page', String(args.page));
  params.set('pageSize', String(args.pageSize));
  const trimmed = args.q?.trim();
  if (trimmed) {
    params.set('q', trimmed);
  }
  return `${PATIENTS_API}?${params.toString()}`;
}

export function patientPath(id: string): string {
  return `${PATIENTS_API}/${encodeURIComponent(id)}`;
}
