import { staffRoute } from '@/lib/auth/staff-route';
import { refundRequestPathOf, type VisitRouteContext } from '@/lib/opd/route-write';

/** GET /api/staff/opd/refund-requests/:id: one request. */
export async function GET(_request: Request, context: VisitRouteContext) {
  return staffRoute({ method: 'GET', path: await refundRequestPathOf(context) });
}
