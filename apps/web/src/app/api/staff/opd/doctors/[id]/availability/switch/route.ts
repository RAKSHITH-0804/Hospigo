import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/opd/doctors/:id/availability/switch: switch a doctor on or off. */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'PUT',
    `/opd/doctors/${encodeURIComponent(id)}/availability/switch`,
  );
}
