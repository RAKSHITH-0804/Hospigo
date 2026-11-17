import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { refreshTokens } from '@/lib/auth/api-client';
import { applyClearCookies, applySessionCookies } from '@/lib/auth/cookies';
import { flightTokens, runRefreshSingleFlight } from '@/lib/auth/refresh-flight';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Silent staff session renewal for same-origin client fetches.
 * Refresh cookie is only sent here (path /api/auth). Never redirects; never returns tokens in JSON.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const refresh = jar.get(sessionConfig.cookieRefreshName)?.value;
  if (!refresh) {
    const response = NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED' },
      {
        status: 401,
        headers: NO_STORE,
      },
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

  // After a switch queued behind (or joined by) this refresh, these are the newest tokens;
  // a refused switch still carries the rotated session. No tokens = the session is gone.
  const rotated = flightTokens(result);
  if (!rotated) {
    const response = NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED' },
      {
        status: 401,
        headers: NO_STORE,
      },
    );
    applyClearCookies(response);
    return response;
  }

  const response = NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
  applySessionCookies(response, rotated);
  return response;
}
