import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** GET /api/staff/opd/visits/:id/consultation: note, prescription and addenda (audited). */
export async function GET(_request: Request, context: VisitRouteContext) {
  return staffRoute({ method: 'GET', path: await visitPathOf(context, '/consultation') });
}

/** PUT /api/staff/opd/visits/:id/consultation: save the draft note. */
export async function PUT(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'PUT', await visitPathOf(context, '/consultation'));
}
