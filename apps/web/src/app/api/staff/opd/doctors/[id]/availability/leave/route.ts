import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** POST /api/staff/opd/doctors/:id/availability/leave: add a leave period. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'POST',
    `/opd/doctors/${encodeURIComponent(id)}/availability/leave`,
  );
}
