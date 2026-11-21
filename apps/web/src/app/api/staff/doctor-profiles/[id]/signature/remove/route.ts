import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** POST /api/staff/doctor-profiles/:id/signature/remove: an Admin stops using a doctor's signature picture. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'POST',
    `/doctor-profiles/${encodeURIComponent(id)}/signature/remove`,
  );
}
