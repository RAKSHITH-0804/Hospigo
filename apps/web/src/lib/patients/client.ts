import { BRANCH_CHANGED_CODE, branchSwitchConfig } from '@/config/branch-switch';
import { PatientListSort, type PatientListSort as ListSort } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import {
  AUTH_REFRESH_SESSION_API,
  clearClientRefreshLatchForTests,
  getClientActiveBranch,
  refreshSessionOnce,
} from '@/lib/auth/client-session';
import type { DuplicateMatch, PatientFieldErrorCode } from './types';

// One refresh latch per tab, shared with the branch switch (see lib/auth/client-session.ts).
export { AUTH_REFRESH_SESSION_API, clearClientRefreshLatchForTests, refreshSessionOnce };

/** Next route handlers that proxy the patients API. Browsers never see tokens. */
export const PATIENTS_API = '/api/staff/patients';
export const PATIENTS_FORM_CONFIG_API = `${PATIENTS_API}/form-config`;
export const UHID_START_NUMBER_API = `${PATIENTS_API}/uhid/start-number`;
/** Returned (never shown) when the caller cancelled the request. */
export const ABORTED_CODE = 'ABORTED';

export type PatientsApiOk<T> = { ok: true; data: T };
export type PatientsApiError = {
  ok: false;
  status: number;
  code: string;
  matches?: DuplicateMatch[];
  fieldErrors?: Record<string, string>;
  /** Extra facts for explaining a refusal (for example the new total after PRICE_CHANGED). */
  reason?: string;
  /** Which field of a print template a refusal is about. */
  field?: string;
  what?: string;
  totalPaise?: number;
  /** Which vitals field a refusal is about. */
  fieldCode?: string;
  /** Which prescription row a refusal is about (0 based). */
  index?: number;
  /** Step 6b: facts that explain a refusal about tests, refunds and cancellations. */
  paymentModeCode?: string;
  /** A visit or request status named by the refusal (the HTTP status is `status`). */
  upstreamStatus?: string;
  series?: string;
  refundablePaise?: number;
  pendingPaise?: number;
  max?: number;
};
export type PatientsApiResult<T> = PatientsApiOk<T> | PatientsApiError;

export type PatientsApiInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
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

async function fetchPatientsOnce<T>(
  path: string,
  init: PatientsApiInit,
): Promise<PatientsApiResult<T>> {
  const hasBody = init.body !== undefined;
  const method = init.method ?? (hasBody ? 'POST' : 'GET');
  const headers: Record<string, string> = hasBody
    ? { Accept: 'application/json', 'Content-Type': 'application/json' }
    : { Accept: 'application/json' };
  if (method !== 'GET') {
    // Stale-tab guard: the branch this page was rendered for. The server refuses the write
    // (409 BRANCH_CHANGED) if another tab has switched branch since.
    const branchId = getClientActiveBranch();
    if (branchId) {
      headers[branchSwitchConfig.headerName] = branchId;
    }
  }
  try {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers,
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
      reason: typeof record.reason === 'string' ? record.reason : undefined,
      field: typeof record.field === 'string' ? record.field : undefined,
      what: typeof record.what === 'string' ? record.what : undefined,
      totalPaise: typeof record.totalPaise === 'number' ? record.totalPaise : undefined,
      fieldCode: typeof record.fieldCode === 'string' ? record.fieldCode : undefined,
      index: typeof record.index === 'number' ? record.index : undefined,
      paymentModeCode:
        typeof record.paymentModeCode === 'string' ? record.paymentModeCode : undefined,
      upstreamStatus: typeof record.status === 'string' ? record.status : undefined,
      series: typeof record.series === 'string' ? record.series : undefined,
      refundablePaise:
        typeof record.refundablePaise === 'number' ? record.refundablePaise : undefined,
      pendingPaise: typeof record.pendingPaise === 'number' ? record.pendingPaise : undefined,
      max: typeof record.max === 'number' ? record.max : undefined,
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
    case BRANCH_CHANGED_CODE:
      return staffCopy.errors.branchChanged;
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
