import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { changePasswordUpstream } from '@/lib/auth/api-client';
import { applySessionCookies } from '@/lib/auth/cookies';
import {
  assertJsonContentType,
  assertOrigin,
  isNonEmptyString,
  mapUpstreamError,
  readJsonBody,
} from '@/lib/auth/http';
import { logBffError, requestIdFrom } from '@/lib/auth/log';

const ROUTE = 'POST /api/auth/change-password';

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
    !isNonEmptyString((body as { currentPassword?: unknown }).currentPassword) ||
    !isNonEmptyString((body as { newPassword?: unknown }).newPassword)
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
  }
  const { currentPassword, newPassword } = body as {
    currentPassword: string;
    newPassword: string;
  };

  const jar = await cookies();
  const token =
    jar.get(sessionConfig.cookieChangeName)?.value ??
    jar.get(sessionConfig.cookieAccessName)?.value;
  if (!token) {
    return mapUpstreamError(401, { route: ROUTE, requestId });
  }

  const upstream = await changePasswordUpstream(request, token, {
    currentPassword,
    newPassword,
  });
  if (!upstream.ok) {
    return mapUpstreamError(upstream.status, {
      retryAfter: upstream.retryAfter,
      upstreamMessage: upstream.message,
      route: ROUTE,
      requestId,
    });
  }

  try {
    const data = upstream.data;
    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.accessToken !== 'string' ||
      typeof data.refreshToken !== 'string' ||
      typeof data.expiresIn !== 'number'
    ) {
      logBffError({
        route: ROUTE,
        upstreamStatus: 200,
        error: new Error('empty_or_invalid_token_pair'),
        requestId,
      });
      return NextResponse.json({ code: 'UNAVAILABLE' }, { status: 502 });
    }
    const response = NextResponse.json({ mustChangePassword: false });
    applySessionCookies(response, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    });
    return response;
  } catch (error) {
    logBffError({
      route: ROUTE,
      upstreamStatus: 200,
      error,
      requestId,
    });
    return NextResponse.json({ code: 'UNAVAILABLE' }, { status: 502 });
  }
}
