import { proxyOpdWrite } from '@/lib/opd/route-write';
import { staffRoute } from '@/lib/auth/staff-route';

type Params = { params: Promise<{ id: string }> };

/** GET /api/staff/indigo/hospitals/:id/library: what this hospital may choose from. */
export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  return staffRoute({ method: 'GET', path: `/indigo/hospitals/${encodeURIComponent(id)}/library` });
}

/** PUT: set what this hospital may choose from. */
export async function PUT(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/indigo/hospitals/${encodeURIComponent(id)}/library`);
}
