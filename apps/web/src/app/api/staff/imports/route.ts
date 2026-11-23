import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/imports: the upload batches of the hospital (forwards page and pageSize). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['page', 'pageSize'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: '/imports', query });
}
