import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { patientRefresh } from '@/lib/auth/api-client';
import { applyClearPatientCookies, applyPatientSessionCookies } from '@/lib/auth/cookies';
import { appUrl, sanitizePatientNextPath } from '@/lib/auth/http';
import { runRefreshSingleFlight } from '@/lib/auth/refresh-flight';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const jar = await cookies();
  const refresh = jar.get(sessionConfig.patientCookieRefreshName)?.value;
  const fallback = sessionConfig.patientHomePath;
  const next = sanitizePatientNextPath(url.searchParams.get('next'), fallback);

  if (!refresh) {
    const response = NextResponse.redirect(
      appUrl(sessionConfig.patientLoginPath, {
        request,
        fallback: sessionConfig.patientLoginPath,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    applyClearPatientCookies(response);
    return response;
  }

  const result = await runRefreshSingleFlight(
    refresh,
    async () => {
      const upstream = await patientRefresh(request, refresh);
      if (!upstream.ok) {
        return { ok: false as const, status: upstream.status };
      }
      return { ok: true as const, data: upstream.data };
    },
    'patient',
  );

  if (!result.ok || !result.data.refreshToken) {
    const response = NextResponse.redirect(
      appUrl(sessionConfig.patientLoginPath, {
        request,
        fallback: sessionConfig.patientLoginPath,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    applyClearPatientCookies(response);
    return response;
  }

  const response = NextResponse.redirect(appUrl(next, { request, fallback }));
  response.headers.set('Cache-Control', 'no-store');
  applyPatientSessionCookies(response, {
    accessToken: result.data.accessToken,
    refreshToken: result.data.refreshToken,
    expiresIn: result.data.expiresIn,
  });
  return response;
}
