import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string; userId: string }> };

/** POST /api/staff/indigo/hospitals/{id}/super-admins/{userId}/reset: proxied to /indigo/hospitals/{id}/super-admins/{userId}/reset (the API decides who may). */
export async function POST(request: Request, context: Params) {
  const { id, userId } = await context.params;
  return proxyOpdWrite(
    request,
    'POST',
    `/indigo/hospitals/${encodeURIComponent(id)}/super-admins/${encodeURIComponent(userId)}/reset`,
  );
}
