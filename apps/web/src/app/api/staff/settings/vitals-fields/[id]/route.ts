import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/settings/vitals-fields/:id: change name, unit, range, switch off or on. */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/settings/vitals-fields/${encodeURIComponent(id)}`);
}
