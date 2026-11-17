import { NextResponse } from 'next/server';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

export async function GET() {
  return staffRoute({
    method: 'GET',
    path: '/patients/uhid/start-number',
  });
}

export async function PUT(request: Request) {
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
    method: 'PUT',
    request,
    path: '/patients/uhid/start-number',
    body: bodyResult.value,
  });
}
