import { NextResponse } from 'next/server';
import { requireAppOrigin, sessionConfig } from '@/config/session';
import { logBffError } from './log';
import type { BrowserAuthErrorCode } from './types';

/** Nest password-rule messages that are safe to echo (plain string only). */
const SAFE_PASSWORD_RULE_MESSAGE = /^Password rejected: (TOO_SHORT|COMMON_PASSWORD)$/;

/** Exact Nest body for bad activation/reset links (must match API). */
export const UPSTREAM_INVALID_LINK_MESSAGE = 'Invalid or expired link';

export function safePasswordRuleMessage(message: unknown): string | undefined {
  if (typeof message !== 'string') {
    return undefined;
  }
  const trimmed = message.trim();
  if (!SAFE_PASSWORD_RULE_MESSAGE.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function isUpstreamInvalidLinkMessage(message: unknown): boolean {
  return typeof message === 'string' && message.trim() === UPSTREAM_INVALID_LINK_MESSAGE;
}

export function assertJsonContentType(request: Request): NextResponse | null {
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ code: 'UNKNOWN' satisfies BrowserAuthErrorCode }, { status: 415 });
  }
  return null;
}

export function assertOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  if (!origin) {
    return NextResponse.json({ code: 'UNKNOWN' satisfies BrowserAuthErrorCode }, { status: 403 });
  }
  let expected: string;
  try {
    expected = requireAppOrigin();
  } catch (error) {
    logBffError({
      route: 'assertOrigin',
      error,
      requestId: request.headers.get('x-request-id') ?? undefined,
    });
    return NextResponse.json({ code: 'UNKNOWN' satisfies BrowserAuthErrorCode }, { status: 500 });
  }
  if (origin !== expected) {
    return NextResponse.json({ code: 'UNKNOWN' satisfies BrowserAuthErrorCode }, { status: 403 });
  }
  return null;
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const raw = await request.text();
  if (raw.length > sessionConfig.bodyLimitBytes) {
    return {
      ok: false,
      response: NextResponse.json(
        { code: 'UNKNOWN' satisfies BrowserAuthErrorCode },
        { status: 413 },
      ),
    };
  }
  try {
    return { ok: true, value: raw === '' ? {} : JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { code: 'UNKNOWN' satisfies BrowserAuthErrorCode },
        { status: 400 },
      ),
    };
  }
}

export type MapUpstreamOptions = {
  retryAfter?: string;
  /** Upstream error `message` field only — never pass full bodies. */
  upstreamMessage?: unknown;
  route: string;
  requestId?: string;
};

export function mapUpstreamError(status: number, options: MapUpstreamOptions): NextResponse {
  if (status === 401) {
    return NextResponse.json(
      { code: 'INVALID_CREDENTIALS' satisfies BrowserAuthErrorCode },
      { status: 401 },
    );
  }
  if (status === 403) {
    return NextResponse.json({ code: 'FORBIDDEN' satisfies BrowserAuthErrorCode }, { status: 403 });
  }
  if (status === 400) {
    const message = safePasswordRuleMessage(options.upstreamMessage);
    return NextResponse.json(
      {
        code: 'VALIDATION' satisfies BrowserAuthErrorCode,
        ...(message ? { message } : {}),
      },
      { status: 400 },
    );
  }
  if (status === 429) {
    const headers = new Headers();
    if (options.retryAfter) {
      headers.set('Retry-After', options.retryAfter);
    }
    return NextResponse.json(
      {
        code: 'RATE_LIMITED' satisfies BrowserAuthErrorCode,
        ...(options.retryAfter ? { retryAfter: options.retryAfter } : {}),
      },
      { status: 429, headers },
    );
  }
  if (status === 502) {
    return NextResponse.json(
      { code: 'UNAVAILABLE' satisfies BrowserAuthErrorCode },
      { status: 502 },
    );
  }
  if (status === 503 || status === 0) {
    return NextResponse.json(
      { code: 'UNAVAILABLE' satisfies BrowserAuthErrorCode },
      { status: 503 },
    );
  }
  logBffError({
    route: options.route,
    upstreamStatus: status,
    error: new Error(`unexpected_upstream_status_${status}`),
    requestId: options.requestId,
  });
  return NextResponse.json({ code: 'UNKNOWN' satisfies BrowserAuthErrorCode }, { status: 500 });
}

/**
 * Safe same-origin relative path for refresh redirects.
 * Rejects protocol-relative, absolute URLs, backslashes, and encoded tricks.
 */
export function sanitizeNextPath(raw: string | null, fallback: string): string {
  if (raw === null || raw === '') {
    return fallback;
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith('/')) {
    return fallback;
  }
  if (decoded.startsWith('//')) {
    return fallback;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) {
    return fallback;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
    return fallback;
  }
  // Reject path that looks like /\/evil or /https:
  if (decoded.includes('://')) {
    return fallback;
  }
  return decoded;
}

/**
 * Patient refresh `next` — must be under `/patient` (exact or `/patient/...`), never `//`.
 */
export function sanitizePatientNextPath(raw: string | null, fallback: string): string {
  const safe = sanitizeNextPath(raw, fallback);
  if (safe === '/patient' || safe.startsWith('/patient/')) {
    return safe;
  }
  return fallback;
}

export function noStoreHeaders(): HeadersInit {
  return { 'Cache-Control': 'no-store' };
}

/**
 * Public origin for absolute redirects. Prefer APP_URL so cookies stay on the
 * host the user typed (127.0.0.1 vs localhost are different cookie jars).
 * Non-production fallback: incoming Host header (never request.url).
 */
export function resolvePublicOrigin(
  request?: Request,
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env['APP_URL'];
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      return new URL(raw.trim()).origin;
    } catch {
      throw new Error('APP_URL must be a valid absolute URL');
    }
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error('APP_URL is required for web auth redirects');
  }
  if (request) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host && host.trim() !== '') {
      const proto =
        (request.headers.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() || 'http';
      try {
        return new URL(`${proto}://${host.trim()}`).origin;
      } catch {
        // fall through
      }
    }
  }
  throw new Error('APP_URL is required (or a Host header in non-production)');
}

/**
 * Absolute URL on the APP_URL origin. Path must pass sanitizeNextPath rules
 * (unsafe paths fall back to `fallback`).
 */
export function appUrl(
  path: string,
  options?: { request?: Request; fallback?: string; env?: Record<string, string | undefined> },
): URL {
  const fallback = options?.fallback ?? '/';
  const safePath = sanitizeNextPath(path, fallback);
  const origin = resolvePublicOrigin(options?.request, options?.env ?? process.env);
  return new URL(safePath, `${origin}/`);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
