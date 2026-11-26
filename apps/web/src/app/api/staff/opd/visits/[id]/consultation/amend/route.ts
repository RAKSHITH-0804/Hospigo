import { proxyOpdWrite, visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/visits/:id/consultation/amend: change a completed note as a new version (Admin). */
export async function POST(request: Request, context: VisitRouteContext) {
  return proxyOpdWrite(request, 'POST', await visitPathOf(context, '/consultation/amend'));
}
