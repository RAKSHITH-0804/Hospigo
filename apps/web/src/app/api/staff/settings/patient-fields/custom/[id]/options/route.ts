import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/settings/patient-fields/custom/:id/options: replace the choices of a dropdown. */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'PUT',
    `/settings/patient-fields/custom/${encodeURIComponent(id)}/options`,
  );
}
