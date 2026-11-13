import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { refreshTokens } from '@/lib/auth/api-client';
import { applyClearCookies, applySessionCookies } from '@/lib/auth/cookies';
import { appUrl, sanitizeNextPath } from '@/lib/auth/http';
import { runRefreshSingleFlight } from '@/lib/auth/refresh-flight';
import { homeForKind } from '@/lib/auth/session';
import type { AuthKind } from '@/lib/auth/types';

function kindFromRefreshToken(refreshToken: string): AuthKind {
  if (refreshToken.startsWith('q.')) {
    return 'HQ';
  }
  return 'HOSPITAL';
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const jar = await cookies();
  const refresh = jar.get(sessionConfig.cookieRefreshName)?.value;
  const kindHint = refresh ? kindFromRefreshToken(refresh) : 'HOSPITAL';
  const fallback = homeForKind(kindHint);
  const next = sanitizeNextPath(url.searchParams.get('next'), fallback);

  if (!refresh) {
    const response = NextResponse.redirect(
      appUrl(sessionConfig.loginPath, { request, fallback: sessionConfig.loginPath }),
    );
    applyClearCookies(response);
    return response;
  }

  const result = await runRefreshSingleFlight(refresh, async () => {
    const upstream = await refreshTokens(request, refresh);
    if (!upstream.ok) {
      return { ok: false as const, status: upstream.status };
    }
    return { ok: true as const, data: upstream.data };
  });

  if (!result.ok || !result.data.refreshToken) {
    const response = NextResponse.redirect(
      appUrl(sessionConfig.loginPath, { request, fallback: sessionConfig.loginPath }),
    );
    applyClearCookies(response);
    return response;
  }

  const response = NextResponse.redirect(appUrl(next, { request, fallback }));
  applySessionCookies(response, {
    accessToken: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresIn: result.data.expiresIn,
  });
  return response;
}
