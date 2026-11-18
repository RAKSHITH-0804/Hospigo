import { NextResponse } from 'next/server';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

/**
 * Shared body of the OPD write routes (start, note, prescription, complete, addendum, vitals):
 * same-origin check, JSON content type, a JSON object body, then the branch-guarded staff call.
 * The API decides everything else (permission, doctor, status); this only keeps junk out.
 */
export async function proxyOpdWrite(
  request: Request,
  method: 'POST' | 'PUT',
  path: string,
): Promise<NextResponse> {
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
  if (
    typeof bodyResult.value !== 'object' ||
    bodyResult.value === null ||
    Array.isArray(bodyResult.value)
  ) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return staffRoute({ method, request, path, body: bodyResult.value });
}

export type VisitRouteContext = { params: Promise<{ id: string }> };

/** The visit path of the API for the id in the URL (the id is encoded). */
export async function visitPathOf(context: VisitRouteContext, tail = ''): Promise<string> {
  const { id } = await context.params;
  return `/opd/visits/${encodeURIComponent(id)}${tail}`;
}
