import { requireApiInternalUrl, sessionConfig } from '@/config/session';
import { logBffError } from './log';
import type { AuthMeProfile, TokenPairResponse } from './types';

export type UpstreamResult<T> =
  | { ok: true; data: T; retryAfter?: string }
  | { ok: false; status: number; retryAfter?: string; message?: string };

type RequestWithSocket = Request & {
  socket?: { remoteAddress?: string | null };
  connection?: { remoteAddress?: string | null };
};

function socketRemoteAddress(request: Request): string | undefined {
  const withSocket = request as RequestWithSocket;
  return (
    withSocket.socket?.remoteAddress?.trim() ||
    withSocket.connection?.remoteAddress?.trim() ||
    undefined
  );
}

/**
 * Client IP for upstream rate limits / audits.
 * When `trustForwardedHeaders` is false (default), only the socket address is used.
 * When true (behind our IIS/nginx), prefer `x-forwarded-for`, then `x-real-ip`, then socket.
 */
export function resolveClientIp(
  request: Request,
  trustForwardedHeaders: boolean = sessionConfig.trustForwardedHeaders,
): string | undefined {
  if (trustForwardedHeaders) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }
    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp) {
      return realIp;
    }
  }
  return socketRemoteAddress(request);
}

function extractUpstreamMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

async function callApi<T>(
  request: Request,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<UpstreamResult<T>> {
  const base = requireApiInternalUrl();
  // Fresh headers only — never copy Cookie / Authorization from the browser Request.
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const ip = resolveClientIp(request);
  if (ip) {
    headers.set('X-Forwarded-For', ip);
  }
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503 };
  }
  const retryAfter = response.headers.get('retry-after') ?? undefined;
  if (!response.ok) {
    let message: string | undefined;
    try {
      const errBody: unknown = await response.json();
      message = extractUpstreamMessage(errBody);
    } catch {
      // ignore non-JSON error bodies
    }
    return { ok: false, status: response.status, retryAfter, message };
  }
  if (response.status === 204) {
    return { ok: true, data: undefined as T, retryAfter };
  }
  try {
    const data = (await response.json()) as T;
    return { ok: true, data, retryAfter };
  } catch (error) {
    logBffError({
      route: `upstream ${path}`,
      upstreamStatus: response.status,
      error,
      requestId: request.headers.get('x-request-id') ?? undefined,
    });
    return { ok: false, status: 502 };
  }
}

export function hospitalLogin(
  request: Request,
  body: { accessCode: string; email: string; password: string },
): Promise<UpstreamResult<TokenPairResponse>> {
  return callApi(request, '/auth/hospital/login', { method: 'POST', json: body });
}

export function hqLogin(
  request: Request,
  body: { email: string; password: string },
): Promise<UpstreamResult<TokenPairResponse>> {
  return callApi(request, '/auth/hq/login', { method: 'POST', json: body });
}

export function refreshTokens(
  request: Request,
  refreshToken: string,
): Promise<UpstreamResult<TokenPairResponse>> {
  return callApi(request, '/auth/refresh', {
    method: 'POST',
    json: { refreshToken },
  });
}

export function logoutUpstream(
  request: Request,
  refreshToken: string,
): Promise<UpstreamResult<unknown>> {
  return callApi(request, '/auth/logout', {
    method: 'POST',
    json: { refreshToken },
  });
}

export function changePasswordUpstream(
  request: Request,
  accessToken: string,
  body: { currentPassword: string; newPassword: string },
): Promise<UpstreamResult<TokenPairResponse>> {
  return callApi(request, '/auth/change-password', {
    method: 'POST',
    json: body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function fetchMe(
  request: Request,
  accessToken: string,
): Promise<UpstreamResult<AuthMeProfile>> {
  return callApi(request, '/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function forgotPasswordUpstream(
  request: Request,
  body: { accessCode: string; email: string },
): Promise<UpstreamResult<{ accepted: true }>> {
  return callApi(request, '/auth/forgot-password', { method: 'POST', json: body });
}

export function hqForgotPasswordUpstream(
  request: Request,
  body: { email: string },
): Promise<UpstreamResult<{ accepted: true }>> {
  return callApi(request, '/auth/hq/forgot-password', { method: 'POST', json: body });
}

export function resetPasswordUpstream(
  request: Request,
  body: { token: string; newPassword: string },
): Promise<UpstreamResult<void>> {
  return callApi(request, '/auth/reset-password', { method: 'POST', json: body });
}

export function activateUpstream(
  request: Request,
  body: { token: string; newPassword: string },
): Promise<UpstreamResult<void>> {
  return callApi(request, '/auth/activate', { method: 'POST', json: body });
}
