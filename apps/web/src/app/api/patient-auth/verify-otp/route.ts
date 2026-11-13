import { NextResponse } from 'next/server';
import { patientVerifyOtp } from '@/lib/auth/api-client';
import { applyPatientSessionCookies } from '@/lib/auth/cookies';
import {
  assertJsonContentType,
  assertOrigin,
  isNonEmptyString,
  mapUpstreamError,
  noStoreHeaders,
  readJsonBody,
} from '@/lib/auth/http';
import { logBffError, requestIdFrom } from '@/lib/auth/log';

const ROUTE = 'POST /api/patient-auth/verify-otp';

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = requestIdFrom(request);
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
  const body = bodyResult.value;
  if (
    typeof body !== 'object' ||
    body === null ||
    !isNonEmptyString((body as { phone?: unknown }).phone) ||
    !isNonEmptyString((body as { code?: unknown }).code)
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400, headers: noStoreHeaders() });
  }
  const { phone, code } = body as { phone: string; code: string };

  const upstream = await patientVerifyOtp(request, { phone, code });
  if (!upstream.ok) {
    const mapped = mapUpstreamError(upstream.status, {
      retryAfter: upstream.retryAfter,
      upstreamMessage: upstream.message,
      route: ROUTE,
      requestId,
    });
    mapped.headers.set('Cache-Control', 'no-store');
    return mapped;
  }

  if (!upstream.data.refreshToken || !upstream.data.accessToken) {
    logBffError({
      route: ROUTE,
      upstreamStatus: 200,
      error: new Error('missing_patient_tokens'),
      requestId,
    });
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500, headers: noStoreHeaders() });
  }

  const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  applyPatientSessionCookies(response, {
    accessToken: upstream.data.accessToken,
    refreshToken: upstream.data.refreshToken,
    expiresIn: upstream.data.expiresIn,
  });
  return response;
}
