import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/queue: today's waiting visits (a doctor's own, or the branch for a nurse). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/opd/queue' });
}
