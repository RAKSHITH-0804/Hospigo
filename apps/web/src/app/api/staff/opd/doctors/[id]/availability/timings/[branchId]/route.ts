import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string; branchId: string }> };

/** PUT /api/staff/opd/doctors/:id/availability/timings/:branchId: replace the weekly timetable in one branch. */
export async function PUT(request: Request, context: Context) {
  const { id, branchId } = await context.params;
  return proxyOpdWrite(
    request,
    'PUT',
    `/opd/doctors/${encodeURIComponent(id)}/availability/timings/${encodeURIComponent(branchId)}`,
  );
}
