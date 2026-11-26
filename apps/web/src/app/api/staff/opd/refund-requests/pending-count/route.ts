import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/refund-requests/pending-count: how many requests wait for a decision (people who may approve). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/opd/refund-requests/pending-count' });
}
