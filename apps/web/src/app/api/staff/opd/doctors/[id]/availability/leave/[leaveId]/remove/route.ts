import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string; leaveId: string }> };

/** POST /api/staff/opd/doctors/:id/availability/leave/:leaveId/remove: remove a leave period. */
export async function POST(request: Request, context: Context) {
  const { id, leaveId } = await context.params;
  return proxyOpdWrite(
    request,
    'POST',
    `/opd/doctors/${encodeURIComponent(id)}/availability/leave/${encodeURIComponent(leaveId)}/remove`,
  );
}
