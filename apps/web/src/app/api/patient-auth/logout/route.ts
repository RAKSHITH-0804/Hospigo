import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { patientLogout } from '@/lib/auth/api-client';
import { applyClearPatientCookies } from '@/lib/auth/cookies';
import { assertJsonContentType, assertOrigin, noStoreHeaders, readJsonBody } from '@/lib/auth/http';

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertOrigin(request);
  if (originError) {
    originError.headers.set('Cache-Control', 'no-store');
    return originError;
  }
  const ctError = assertJsonContentType(request);
  if (ctError) {
    ctError.headers.set('Cache-Control', 'no-store');
    return ctError;
  }
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    bodyResult.response.headers.set('Cache-Control', 'no-store');
    return bodyResult.response;
  }

  const jar = await cookies();
  const refresh = jar.get(sessionConfig.patientCookieRefreshName)?.value;
  if (refresh) {
    try {
      await patientLogout(request, refresh);
    } catch {
      // Always clear cookies below.
    }
  }

  const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  applyClearPatientCookies(response);
  return response;
}
