import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { checkBranchGuard } from './branch-guard';
import { callStaffApi, type CallStaffApiOptions } from './staff-api';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export type StaffRouteErrorCode =
  'UNAUTHORIZED' | 'FORBIDDEN' | 'SESSION_EXPIRED' | 'UNAVAILABLE' | 'UNKNOWN';

export type StaffRouteOptions = {
  method?: CallStaffApiOptions['method'];
  path: string;
  query?: CallStaffApiOptions['query'];
  body?: unknown;
  /** A file download: the API's bytes are passed on with this type and file name. */
  download?: { contentType: string; fileName: string };
  /**
   * The incoming browser request. REQUIRED for every write (POST/PUT/PATCH/DELETE): it carries
   * the stale-tab branch header checked by the branch guard. A write without it is refused.
   */
  request?: Request;
};

function jsonResponse(data: unknown, status: number): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/** The only upstream error facts a browser may receive (codes, numbers, small labels; no tokens). */
export type UpstreamErrorPayload = {
  code?: string;
  message?: string;
  matches?: unknown;
  fieldErrors?: unknown;
  reason?: string;
  what?: string;
  totalPaise?: number;
  fieldCode?: string;
  /** A print template that was refused: which field, and why (`reason`). */
  field?: string;
  index?: number;
  /** Step 6b: facts that explain a refusal about tests, refunds and cancellations. */
  paymentModeCode?: string;
  /** A visit or request status (for example "REJECTED"). */
  status?: string;
  series?: string;
  refundablePaise?: number;
  pendingPaise?: number;
  max?: number;
};

const SAFE_TEXT_KEYS = [
  'field',
  'reason',
  'what',
  'fieldCode',
  'paymentModeCode',
  'status',
  'series',
] as const;
const SAFE_NUMBER_KEYS = ['totalPaise', 'index', 'refundablePaise', 'pendingPaise', 'max'] as const;

/** Pick only known upstream error fields for the browser. Never forwards tokens. */
function safeUpstreamErrorPayload(body: Record<string, unknown> | undefined): UpstreamErrorPayload {
  const out: UpstreamErrorPayload = {};
  if (!body) {
    return out;
  }
  if (typeof body.code === 'string') {
    out.code = body.code;
  }
  if (typeof body.message === 'string') {
    out.message = body.message;
  }
  if (Array.isArray(body.matches)) {
    out.matches = body.matches;
  }
  if (body.fieldErrors !== undefined && typeof body.fieldErrors === 'object') {
    out.fieldErrors = body.fieldErrors;
  }
  // Small facts a screen needs to explain a refusal (never tokens or personal data).
  for (const key of SAFE_TEXT_KEYS) {
    const value = body[key];
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  for (const key of SAFE_NUMBER_KEYS) {
    const value = body[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Shared Next route-handler path for staff upstream calls.
 * Returns JSON only (never redirects). Uses the httpOnly access cookie via callStaffApi.
 *
 * Cookie-only gate: no access cookie → JSON 401 UNAUTHORIZED. There is NO /auth/me
 * call and NO permission check here. The API is the only authority: it verifies the
 * token, the token kind (hospital only) and the permission on every route, and answers
 * 401/403, which are mapped below (401 → SESSION_EXPIRED, 403 → FORBIDDEN).
 * This helper does not attempt refresh; the client helper calls /api/auth/refresh-session.
 */
export async function staffRoute(options: StaffRouteOptions): Promise<NextResponse> {
  const jar = await cookies();
  const access = jar.get(sessionConfig.cookieAccessName)?.value;
  if (!access) {
    return jsonResponse({ code: 'UNAUTHORIZED' satisfies StaffRouteErrorCode }, 401);
  }

  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  if (method !== 'GET') {
    const blocked = checkBranchGuard(options.request, access);
    if (blocked) {
      return blocked;
    }
  }
  const result = await callStaffApi(options.path, {
    method,
    query: options.query,
    body: options.body,
    ...(options.download ? { raw: true } : {}),
  });

  if (result.ok && options.download) {
    return new NextResponse(result.data as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': options.download.contentType,
        'Content-Disposition': `attachment; filename="${options.download.fileName}"`,
        ...NO_STORE,
      },
    });
  }
  if (result.ok) {
    return jsonResponse(result.data ?? null, 200);
  }

  if (result.status === 401) {
    return jsonResponse(
      {
        code: 'SESSION_EXPIRED' satisfies StaffRouteErrorCode,
        ...safeUpstreamErrorPayload(result.body),
      },
      401,
    );
  }
  if (result.status === 403) {
    return jsonResponse(
      { code: 'FORBIDDEN' satisfies StaffRouteErrorCode, ...safeUpstreamErrorPayload(result.body) },
      403,
    );
  }
  if (result.status === 503 || result.status === 502) {
    return jsonResponse({ code: 'UNAVAILABLE' satisfies StaffRouteErrorCode }, result.status);
  }

  const payload = safeUpstreamErrorPayload(result.body);
  if (result.message && !payload.message) {
    payload.message = result.message;
  }
  if (!payload.code) {
    payload.code = 'UNKNOWN';
  }
  return jsonResponse(payload, result.status);
}
