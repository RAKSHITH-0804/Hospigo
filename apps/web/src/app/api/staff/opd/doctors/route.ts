import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/doctors: doctors of the active branch with availability and fees. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/opd/doctors' });
}
