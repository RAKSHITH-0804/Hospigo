import { NextResponse } from 'next/server';
import { assertOrigin } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

type Params = { params: Promise<{ id: string }> };

/** PUT /api/staff/print-library/templates/:id/choose?scope=branch|hospital: use a design. */
export async function PUT(request: Request, context: Params): Promise<NextResponse> {
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const { id } = await context.params;
  const scope = new URL(request.url).searchParams.get('scope') === 'branch' ? 'branch' : 'hospital';
  return staffRoute({
    method: 'PUT',
    request,
    path: `/print-library/templates/${encodeURIComponent(id)}/choose`,
    query: { scope },
  });
}
