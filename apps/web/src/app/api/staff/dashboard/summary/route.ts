import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/dashboard/summary: the real numbers for the signed-in person's dashboard. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/dashboard/summary' });
}
