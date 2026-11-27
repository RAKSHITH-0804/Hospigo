import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string }> };

/** PUT /api/staff/indigo/hospitals/{id}/print-design: proxied to /indigo/hospitals/{id}/print-design (the API decides who may). */
export async function PUT(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/indigo/hospitals/${encodeURIComponent(id)}/print-design`);
}
