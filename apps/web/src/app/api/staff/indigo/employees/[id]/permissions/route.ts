import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string }> };

/** PUT /api/staff/indigo/employees/{id}/permissions: proxied to /indigo/employees/{id}/permissions (the API decides who may). */
export async function PUT(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/indigo/employees/${encodeURIComponent(id)}/permissions`);
}
