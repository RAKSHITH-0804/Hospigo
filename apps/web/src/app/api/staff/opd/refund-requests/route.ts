import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/refund-requests?status=&page=&pageSize=: the branch's requests, newest first. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['status', 'page', 'pageSize', 'branch'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: '/opd/refund-requests', query });
}
