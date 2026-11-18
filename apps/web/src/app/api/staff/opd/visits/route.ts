import { NextResponse } from 'next/server';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

/**
 * POST /api/staff/opd/visits: create the visit, bill it and take the payment in one step.
 * The API decides the amount (the screen sends only the total it showed, as a safety check) and
 * enforces permissions; this route only checks origin, content type and the branch guard.
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
    path: '/opd/visits',
    body: bodyResult.value,
  });
}
