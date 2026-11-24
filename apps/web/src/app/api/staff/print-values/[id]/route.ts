import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/print-values/:id: change the label or text of a value, or switch it off or on. */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/print-values/${encodeURIComponent(id)}`);
}
