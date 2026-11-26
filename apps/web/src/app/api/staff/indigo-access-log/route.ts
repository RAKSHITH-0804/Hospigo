import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/indigo-access-log?page=: who from Indigo entered this hospital (needs indigo.access.read). */
export async function GET(request: Request) {
  const page = new URL(request.url).searchParams.get('page') ?? '1';
  return staffRoute({ method: 'GET', path: '/indigo-access-log', query: { page } });
}
