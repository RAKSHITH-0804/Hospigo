import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite } from '@/lib/opd/route-write';

/** GET /api/staff/people: the staff list (forwards q, status and page; the API narrows by branch). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['q', 'status', 'page'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: '/staff', query });
}

/** POST /api/staff/people: add a staff member. The API checks the permission, the scope and every value. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/staff');
}
