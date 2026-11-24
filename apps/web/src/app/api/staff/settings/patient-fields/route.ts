import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/settings/patient-fields: the built-in and own registration fields (read again after a change). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/settings/patient-fields' });
}
