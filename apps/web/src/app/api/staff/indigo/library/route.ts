import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/indigo/library: the template library (Indigo Owner; the API decides). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/indigo/library' });
}
