import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/visits/:id/complete: complete the note and the visit. */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await visitPathOf(context, '/complete'));
}
