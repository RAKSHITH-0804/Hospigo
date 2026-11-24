import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** POST: the doctor cancels a request that is still waiting. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'POST',
    `/doctor-profiles/me/leave-requests/${encodeURIComponent(id)}/cancel`,
  );
}
