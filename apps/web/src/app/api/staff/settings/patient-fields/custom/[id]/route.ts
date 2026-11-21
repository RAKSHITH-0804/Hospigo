import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/staff/settings/patient-fields/custom/:id (the id is encoded). */
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'PATCH',
    `/settings/patient-fields/custom/${encodeURIComponent(id)}`,
  );
}
