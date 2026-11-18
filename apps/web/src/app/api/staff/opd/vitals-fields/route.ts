import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/vitals-fields: the active vitals fields of the hospital. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/opd/vitals-fields' });
}
