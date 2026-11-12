import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { logoutUpstream } from '@/lib/auth/api-client';
import { applyClearCookies } from '@/lib/auth/cookies';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const ctError = assertJsonContentType(request);
  if (ctError) {
    return ctError;
  }
  // Consume body (size-limited) even if empty object.
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const jar = await cookies();
  const refresh = jar.get(sessionConfig.cookieRefreshName)?.value;
  if (refresh) {
    try {
      await logoutUpstream(request, refresh);
    } catch {
      // Always clear cookies below.
    }
  }

  const response = new NextResponse(null, { status: 204 });
  applyClearCookies(response);
  return response;
}
