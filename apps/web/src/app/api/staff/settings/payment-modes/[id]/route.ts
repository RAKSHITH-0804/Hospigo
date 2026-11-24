import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/settings/payment-modes/:id: rename, change the reference flag, switch off or on. */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/settings/payment-modes/${encodeURIComponent(id)}`);
}
