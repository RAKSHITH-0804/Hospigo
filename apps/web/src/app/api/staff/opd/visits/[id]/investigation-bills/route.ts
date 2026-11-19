import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/visits/:id/investigation-bills: bill the chosen tests and take payment. */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await visitPathOf(context, '/investigation-bills'));
}
