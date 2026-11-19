import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** GET /api/staff/opd/visits/:id/investigations: the tests of one visit (and its bills for reception). */
export async function GET(_request: Request, context: VisitRouteContext) {
  return staffRoute({ method: 'GET', path: await visitPathOf(context, '/investigations') });
}

/** PUT /api/staff/opd/visits/:id/investigations: the doctor sets the tests of the visit. */
export async function PUT(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'PUT', await visitPathOf(context, '/investigations'));
}
