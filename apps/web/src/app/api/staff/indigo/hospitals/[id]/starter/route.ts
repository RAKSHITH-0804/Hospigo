import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string }> };

/** POST /api/staff/indigo/hospitals/:id/starter: the starter masters (Owner). */
export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'POST', `/indigo/hospitals/${encodeURIComponent(id)}/starter`);
}
