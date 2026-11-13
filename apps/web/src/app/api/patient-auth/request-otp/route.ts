import { NextResponse } from 'next/server';
import { patientRequestOtp } from '@/lib/auth/api-client';
import {
  assertJsonContentType,
  assertOrigin,
  isNonEmptyString,
  mapUpstreamError,
  noStoreHeaders,
  readJsonBody,
} from '@/lib/auth/http';
import { requestIdFrom } from '@/lib/auth/log';

const ROUTE = 'POST /api/patient-auth/request-otp';

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
    !isNonEmptyString((body as { phone?: unknown }).phone)
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400, headers: noStoreHeaders() });
  }
  const phone = (body as { phone: string }).phone;

  const upstream = await patientRequestOtp(request, { phone });
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

  return NextResponse.json(
    { ok: true, resendAfterSec: upstream.data.resendAfterSec },
    { headers: noStoreHeaders() },
  );
}
