import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** GET /api/staff/opd/visits/:id/vitals: current values and history. */
export async function GET(_request: Request, context: VisitRouteContext) {
  return staffRoute({ method: 'GET', path: await visitPathOf(context, '/vitals') });
}

/** POST /api/staff/opd/visits/:id/vitals: record or correct readings (all or nothing). */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await visitPathOf(context, '/vitals'));
}
