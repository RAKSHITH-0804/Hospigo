import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/doctor-profiles/:id: an Admin corrects a doctor (the id is encoded; the API decides who may). */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyOpdWrite(request, 'PUT', `/doctor-profiles/${encodeURIComponent(id)}`);
}
