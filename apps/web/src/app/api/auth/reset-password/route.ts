import { NextResponse } from 'next/server';
import { resetPasswordUpstream } from '@/lib/auth/api-client';
import {
  assertJsonContentType,
  assertOrigin,
  isNonEmptyString,
  isUpstreamInvalidLinkMessage,
  mapUpstreamError,
  readJsonBody,
} from '@/lib/auth/http';
import { requestIdFrom } from '@/lib/auth/log';
import type { BrowserAuthErrorCode } from '@/lib/auth/types';

const ROUTE = 'POST /api/auth/reset-password';

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
    !isNonEmptyString((body as { token?: unknown }).token) ||
    !isNonEmptyString((body as { newPassword?: unknown }).newPassword)
  ) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
  }
  const { token, newPassword } = body as { token: string; newPassword: string };

  const upstream = await resetPasswordUpstream(request, { token, newPassword });
  if (upstream.ok) {
    return new NextResponse(null, { status: 204 });
  }
  if (upstream.status === 400 && isUpstreamInvalidLinkMessage(upstream.message)) {
    return NextResponse.json(
      { code: 'INVALID_LINK' satisfies BrowserAuthErrorCode },
      { status: 400 },
    );
  }
  return mapUpstreamError(upstream.status, {
    retryAfter: upstream.retryAfter,
    upstreamMessage: upstream.message,
    route: ROUTE,
    requestId,
  });
}
