import { callStaffApi, type CallStaffApiOptions } from '@/lib/auth/staff-api';
import { redirectToRefresh } from '@/lib/auth/guards';

/**
 * Result of a first-paint fetch made on the SERVER (server components call the API
 * directly, not through our own route handlers). The API stays the authority:
 * 401 → silent refresh redirect, 403 / 404 / 400 / outage are returned for the page to show.
 */
/** API paths (the API origin is added by callStaffApi). */
export const API_PATIENTS = '/patients';
export const API_PATIENT_FORM_CONFIG = '/patients/form-config';
export const API_UHID_START_NUMBER = '/patients/uhid/start-number';

export type ServerFetch<T> =
  | { status: 'ok'; data: T }
  | { status: 'forbidden' }
  | { status: 'notFound' }
  | { status: 'invalid'; fieldErrors?: Record<string, string> }
  | { status: 'error'; code: 'UNAVAILABLE' | 'UNKNOWN' };

function fieldErrorsOf(
  body: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const raw = body?.fieldErrors;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export async function fetchStaffOnServer<T>(
  path: string,
  query?: CallStaffApiOptions['query'],
): Promise<ServerFetch<T>> {
  const result = await callStaffApi<T>(path, { method: 'GET', query });
  if (result.ok) {
    return { status: 'ok', data: result.data };
  }
  if (result.status === 401) {
    // Same-origin refresh route only (redirectToRefresh sanitizes the target).
    return redirectToRefresh();
  }
  if (result.status === 403) {
    return { status: 'forbidden' };
  }
  if (result.status === 404) {
    return { status: 'notFound' };
  }
  if (result.status === 400) {
    return { status: 'invalid', fieldErrors: fieldErrorsOf(result.body) };
  }
  return {
    status: 'error',
    code: result.status === 502 || result.status === 503 ? 'UNAVAILABLE' : 'UNKNOWN',
  };
}

/** Map a failed server fetch to the same codes the client helper uses (errorMessageFor). */
export function serverErrorCode(failure: Exclude<ServerFetch<unknown>, { status: 'ok' }>): string {
  switch (failure.status) {
    case 'forbidden':
      return 'FORBIDDEN';
    case 'error':
      return failure.code;
    default:
      return 'UNKNOWN';
  }
}
