import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/terminology: the words this hospital prefers, as { items: { key: text } }. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/terminology' });
}
