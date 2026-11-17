import { NextResponse } from 'next/server';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/patients — list/browse (forwards sort, page, pageSize, and q or at most one filter). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['sort', 'q', 'uhid', 'phone', 'name', 'page', 'pageSize'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') {
      query[key] = value;
    }
  }
  return staffRoute({
    method: 'GET',
    path: '/patients',
    query,
  });
}

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
    path: '/patients',
    body: bodyResult.value,
  });
}
