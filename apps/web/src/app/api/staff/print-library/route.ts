import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/print-library: the designs and logos Indigo assigned to this hospital. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/print-library' });
}
