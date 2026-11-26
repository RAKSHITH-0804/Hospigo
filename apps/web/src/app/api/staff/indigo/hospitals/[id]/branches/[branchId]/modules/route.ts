import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string; branchId: string }> };

/** PUT /api/staff/indigo/hospitals/:id/branches/:branchId/modules: modules of ONE branch (Owner). */
export async function PUT(request: Request, context: Params) {
  const { id, branchId } = await context.params;
  return proxyOpdWrite(
    request,
    'PUT',
    `/indigo/hospitals/${encodeURIComponent(id)}/branches/${encodeURIComponent(branchId)}/modules`,
  );
}
