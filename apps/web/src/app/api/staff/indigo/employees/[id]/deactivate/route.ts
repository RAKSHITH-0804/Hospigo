import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string }> };

/** POST /api/staff/indigo/employees/:id/deactivate. */
export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'POST', `/indigo/employees/${encodeURIComponent(id)}/deactivate`);
}
