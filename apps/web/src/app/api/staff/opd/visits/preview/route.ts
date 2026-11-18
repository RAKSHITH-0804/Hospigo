import { NextResponse } from 'next/server';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

/**
 * POST /api/staff/opd/visits/preview: what creating the visit would charge. Read-only on the
 * API side, but still a POST (JSON body), so it passes the same origin and branch checks.
 */
export async function POST(request: Request) {
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
  if (typeof bodyResult.value !== 'object' || bodyResult.value === null) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return staffRoute({
    method: 'POST',
    request,
    path: '/opd/visits/preview',
    body: bodyResult.value,
  });
}
