import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/investigations/pending: tests ordered by doctors and not yet billed. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/opd/investigations/pending' });
}
