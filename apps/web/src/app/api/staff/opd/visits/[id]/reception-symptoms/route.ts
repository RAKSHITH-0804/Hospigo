import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** PUT /api/staff/opd/visits/:id/reception-symptoms: reception sets or clears the symptoms (until the doctor starts). */
export async function PUT(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'PUT', await visitPathOf(context, '/reception-symptoms'));
}
