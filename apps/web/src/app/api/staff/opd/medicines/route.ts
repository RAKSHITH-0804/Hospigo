import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/medicines?q=&limit=: search the medicines list for the prescription. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  const q = url.searchParams.get('q');
  const limit = url.searchParams.get('limit');
  if (q !== null) {
    query.q = q;
  }
  if (limit !== null) {
    query.limit = limit;
  }
  return staffRoute({ method: 'GET', path: '/opd/medicines', query });
}
