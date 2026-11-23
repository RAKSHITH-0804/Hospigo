import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/prices/history: all versions of one price (the API checks the target). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['itemId', 'doctorProfileId', 'visitType'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: '/opd/prices/history', query });
}
