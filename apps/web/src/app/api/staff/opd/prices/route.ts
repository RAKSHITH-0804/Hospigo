import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/prices: the price list (forwards q, kind, branchId, page and pageSize). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['q', 'kind', 'branchId', 'page', 'pageSize'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: '/opd/prices', query });
}
