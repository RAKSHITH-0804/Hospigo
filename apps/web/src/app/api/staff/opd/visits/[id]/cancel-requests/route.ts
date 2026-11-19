import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/visits/:id/cancel-requests: ask an Admin to cancel a waiting visit. */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await visitPathOf(context, '/cancel-requests'));
}
