import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { indigoEnterUpstream } from '@/lib/auth/api-client';
import { applyClearCookies, applySessionCookies } from '@/lib/auth/cookies';
import {
  assertJsonContentType,
  assertOrigin,
  mapUpstreamError,
  readJsonBody,
} from '@/lib/auth/http';
import { requestIdFrom } from '@/lib/auth/log';

const ROUTE = 'POST /api/auth/indigo-enter';
const HOSPITAL_ID_MAX = 64;

/**
 * POST /api/auth/indigo-enter  { hospitalId }
 * An Indigo person (signed in without an access code) enters one hospital. The API checks everything
 * (a valid Indigo token, an active Indigo user, an active hospital, the hospitals of an Employee) and
 * gives one answer for every refusal. On success the browser gets the HOSPITAL session in httpOnly
 * cookies and the Indigo session cookies are replaced. Same-origin JSON; never redirects.
 */
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
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const hospitalId =
    typeof body.value === 'object' && body.value !== null
      ? (body.value as { hospitalId?: unknown }).hospitalId
      : undefined;
  if (
    typeof hospitalId !== 'string' ||
    hospitalId.length === 0 ||
    hospitalId.length > HOSPITAL_ID_MAX
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
  }
  const jar = await cookies();
  const access = jar.get(sessionConfig.cookieAccessName)?.value;
  if (!access) {
    const response = NextResponse.json({ code: 'SESSION_EXPIRED' }, { status: 401 });
    applyClearCookies(response);
    return response;
  }
  const upstream = await indigoEnterUpstream(request, access, hospitalId);
  if (!upstream.ok) {
    if (upstream.status === 403) {
      return NextResponse.json({ code: 'HOSPITAL_NOT_AVAILABLE' }, { status: 403 });
    }
    return mapUpstreamError(upstream.status, {
      retryAfter: upstream.retryAfter,
      upstreamMessage: upstream.message,
      route: ROUTE,
      requestId,
    });
  }
  if (!upstream.data.refreshToken) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }
  const response = NextResponse.json({ ok: true });
  applySessionCookies(response, {
    accessToken: upstream.data.accessToken,
    refreshToken: upstream.data.refreshToken,
    expiresIn: upstream.data.expiresIn,
  });
  return response;
}
