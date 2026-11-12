import { NextResponse } from 'next/server';
import { forgotPasswordUpstream } from '@/lib/auth/api-client';
import {
  assertJsonContentType,
  assertOrigin,
  isNonEmptyString,
  mapUpstreamError,
  readJsonBody,
} from '@/lib/auth/http';
import { logBffError, requestIdFrom } from '@/lib/auth/log';

const ROUTE = 'POST /api/auth/forgot-password';

function accepted(): NextResponse {
  return NextResponse.json({ accepted: true }, { status: 202 });
}

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
    !isNonEmptyString((body as { accessCode?: unknown }).accessCode) ||
    !isNonEmptyString((body as { email?: unknown }).email)
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
  }
  const { accessCode, email } = body as { accessCode: string; email: string };

  const upstream = await forgotPasswordUpstream(request, { accessCode, email });
  if (upstream.ok) {
    return accepted();
  }
  if (upstream.status === 429) {
    return mapUpstreamError(429, {
      retryAfter: upstream.retryAfter,
      route: ROUTE,
      requestId,
    });
  }
  if (upstream.status === 503 || upstream.status === 0 || upstream.status === 502) {
    return mapUpstreamError(upstream.status === 502 ? 503 : upstream.status, {
      route: ROUTE,
      requestId,
    });
  }
  if (upstream.status >= 500) {
    return mapUpstreamError(503, { route: ROUTE, requestId });
  }
  // Other 4xx: do not reveal account existence.
  logBffError({
    route: ROUTE,
    upstreamStatus: upstream.status,
    error: new Error(`forgot_masked_as_accepted_${upstream.status}`),
    requestId,
  });
  return accepted();
}
