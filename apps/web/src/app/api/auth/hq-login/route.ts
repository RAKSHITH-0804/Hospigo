import { NextResponse } from 'next/server';
import { hqLogin } from '@/lib/auth/api-client';
import {
  applyChangePasswordCookie,
  applyClearCookies,
  applySessionCookies,
} from '@/lib/auth/cookies';
import {
  assertJsonContentType,
  assertOrigin,
  isNonEmptyString,
  mapUpstreamError,
  readJsonBody,
} from '@/lib/auth/http';
import { logBffError, requestIdFrom } from '@/lib/auth/log';

const ROUTE = 'POST /api/auth/hq-login';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = requestIdFrom(request);
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const ctError = assertJsonContentType(request);
  if (ctError) {
    return ctError;
  }
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }
  const body = bodyResult.value;
  if (
    typeof body !== 'object' ||
    body === null ||
    !isNonEmptyString((body as { email?: unknown }).email) ||
    !isNonEmptyString((body as { password?: unknown }).password)
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
  }
  const { email, password } = body as { email: string; password: string };

  const upstream = await hqLogin(request, { email, password });
  if (!upstream.ok) {
    return mapUpstreamError(upstream.status, {
      retryAfter: upstream.retryAfter,
      upstreamMessage: upstream.message,
      route: ROUTE,
      requestId,
    });
  }

  if (upstream.data.mustChangePassword) {
    const response = NextResponse.json({ mustChangePassword: true });
    applyClearCookies(response);
    applyChangePasswordCookie(response, upstream.data.accessToken, upstream.data.expiresIn);
    return response;
  }

  if (!upstream.data.refreshToken) {
    logBffError({
      route: ROUTE,
      upstreamStatus: 200,
      error: new Error('missing_refresh_token'),
      requestId,
    });
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }

  const response = NextResponse.json({ mustChangePassword: false });
  applySessionCookies(response, {
    accessToken: upstream.data.accessToken,
    refreshToken: upstream.data.refreshToken,
    expiresIn: upstream.data.expiresIn,
  });
  return response;
}
