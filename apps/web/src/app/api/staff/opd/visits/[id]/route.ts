import { staffRoute } from '@/lib/auth/staff-route';
import { visitPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** GET /api/staff/opd/visits/:id: one visit (with its bill when the caller may read money). */
export async function GET(_request: Request, context: VisitRouteContext) {
  return staffRoute({ method: 'GET', path: await visitPathOf(context) });
}
