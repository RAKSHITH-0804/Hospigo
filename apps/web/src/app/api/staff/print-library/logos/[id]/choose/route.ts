import { NextResponse } from 'next/server';
import { assertOrigin } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

type Params = { params: Promise<{ id: string }> };

/** PUT /api/staff/print-library/logos/:id/choose: use a logo for the hospital. */
export async function PUT(request: Request, context: Params): Promise<NextResponse> {
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const { id } = await context.params;
  return staffRoute({
    method: 'PUT',
    request,
    path: `/print-library/logos/${encodeURIComponent(id)}/choose`,
  });
}
