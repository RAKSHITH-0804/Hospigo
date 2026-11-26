import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/indigo-hospitals: the hospitals the signed-in Indigo person may switch to. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/auth/indigo/hospitals' });
}
