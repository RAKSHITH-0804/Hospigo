import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** POST: an Admin decides one request (approve). The API checks permission, branch scope and state. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'POST', `/opd/leave-requests/${encodeURIComponent(id)}/approve`);
}
