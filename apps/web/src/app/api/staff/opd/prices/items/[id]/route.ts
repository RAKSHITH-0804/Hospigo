import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** POST /api/staff/opd/prices/items/:id: a new price for the registration fee or a test. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'POST', `/opd/prices/items/${encodeURIComponent(id)}`);
}
