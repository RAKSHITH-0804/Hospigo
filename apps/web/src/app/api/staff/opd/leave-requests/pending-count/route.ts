import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/leave-requests/pending-count: how many leave requests wait (people who may decide). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/opd/leave-requests/pending-count' });
}
