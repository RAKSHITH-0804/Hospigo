import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string }> };

/** PUT /api/staff/indigo/library/templates/{id}: proxied to /indigo/library/templates/{id} (the API decides who may). */
export async function PUT(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/indigo/library/templates/${encodeURIComponent(id)}`);
}
