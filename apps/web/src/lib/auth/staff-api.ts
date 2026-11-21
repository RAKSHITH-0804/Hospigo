import { cookies, headers } from 'next/headers';
import { sessionConfig } from '@/config/session';
import { callApi, type UpstreamResult } from './api-client';

export type CallStaffApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** The answer is a file: its bytes are returned as an ArrayBuffer instead of JSON. */
  raw?: boolean;
};

function buildPath(path: string, query?: CallStaffApiOptions['query']): string {
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

/**
 * Server-only staff API call using the staff access cookie.
 * Fresh headers only (Bearer + JSON + X-Forwarded-For) — never forwards browser Cookie.
 */
export async function callStaffApi<T>(
  path: string,
  options: CallStaffApiOptions = {},
): Promise<UpstreamResult<T>> {
  const jar = await cookies();
  const access = jar.get(sessionConfig.cookieAccessName)?.value;
  if (!access) {
    return { ok: false, status: 401 };
  }

  const headersList = await headers();
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? '127.0.0.1';
  const synthetic = new Request(`${proto}://${host}/`, {
    headers: {
      'x-forwarded-for': headersList.get('x-forwarded-for') ?? '',
      'x-real-ip': headersList.get('x-real-ip') ?? '',
    },
  });

  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  return callApi<T>(synthetic, buildPath(path, options.query), {
    method,
    json: options.body,
    timeoutMs: sessionConfig.staffUpstreamTimeoutMs,
    raw: options.raw,
    headers: { Authorization: `Bearer ${access}` },
  });
}
