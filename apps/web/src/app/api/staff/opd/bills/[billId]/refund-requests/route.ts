import { billPathOf, proxyOpdWrite, type BillRouteContext } from '@/lib/opd/route-write';

/** POST /api/staff/opd/bills/:billId/refund-requests: ask an Admin for money back on one bill. */
export async function POST(request: Request, context: BillRouteContext) {
  return proxyOpdWrite(request, 'POST', await billPathOf(context, '/refund-requests'));
}
