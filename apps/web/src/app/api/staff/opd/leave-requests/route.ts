import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/leave-requests: requests of the doctors the caller may manage (status, page). */
export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : null;
  const query: Record<string, string> = {};
  for (const key of ['status', 'page', 'pageSize']) {
    const value = params?.get(key);
    if (value) {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: '/opd/leave-requests', query });
}
