import { NextResponse } from 'next/server';
import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite } from '@/lib/opd/route-write';

/** GET /api/staff/print-values: the values of the hospital and of this branch (the API checks the permission). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/print-values/manage' });
}

/**
 * POST /api/staff/print-values?scope=branch|hospital: add a value. Any other scope is refused here
 * already; the API checks the permission (and, for the hospital, the permission in every branch).
 */
export async function POST(request: Request) {
  const all = new URL(request.url).searchParams.getAll('scope');
  if (all.length > 1 || (all.length === 1 && all[0] !== 'branch' && all[0] !== 'hospital')) {
    return NextResponse.json(
      { code: 'PRINT_SCOPE_INVALID' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return proxyOpdWrite(
    request,
    'POST',
    `/print-values${all.length === 1 ? `?scope=${all[0]}` : ''}`,
  );
}
