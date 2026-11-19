import { proxyOpdWrite, refundRequestPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/refund-requests/:id/reject: an Admin rejects with a note. */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await refundRequestPathOf(context, '/reject'));
}
