import { NextResponse } from 'next/server';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  return staffRoute({
    method: 'GET',
    path: `/patients/${encodeURIComponent(id)}`,
  });
}

export async function PATCH(request: Request, context: Params) {
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
  const { id } = await context.params;
  return staffRoute({
    method: 'PATCH',
    request,
    path: `/patients/${encodeURIComponent(id)}`,
    body: bodyResult.value,
  });
}
