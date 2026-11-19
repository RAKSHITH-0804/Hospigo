import { proxyOpdWrite, refundRequestPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/refund-requests/:id/approve: an Admin approves (the API checks who). */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await refundRequestPathOf(context, '/approve'));
}
