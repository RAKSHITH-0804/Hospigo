import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** PUT /api/staff/opd/visits/:id/prescription: replace the draft prescription. */
export async function PUT(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'PUT', await visitPathOf(context, '/prescription'));
}
