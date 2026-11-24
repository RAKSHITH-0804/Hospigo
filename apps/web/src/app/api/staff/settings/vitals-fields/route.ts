import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite } from '@/lib/opd/route-write';

/** GET /api/staff/settings/vitals-fields: all vitals fields (the API checks the permission). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/settings/vitals-fields' });
}

/** POST /api/staff/settings/vitals-fields: add a vitals field. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/vitals-fields');
}
