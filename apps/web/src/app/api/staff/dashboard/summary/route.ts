import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/dashboard/summary: the real numbers for the signed-in person's dashboard. */
export async function GET(request?: Request) {
  const all = request ? new URL(request.url).searchParams.get('branch') === 'ALL' : false;
  return staffRoute({
    method: 'GET',
    path: '/dashboard/summary',
    query: all ? { branch: 'ALL' } : undefined,
  });
}
