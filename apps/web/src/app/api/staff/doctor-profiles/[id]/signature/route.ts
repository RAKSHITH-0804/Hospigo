import { proxyPictureUpload } from '@/lib/images/route-upload';

type Context = { params: Promise<{ id: string }> };

/** PUT /api/staff/doctor-profiles/:id/signature: an Admin uploads for a doctor in their scope (the id is encoded). */
export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyPictureUpload(request, `/doctor-profiles/${encodeURIComponent(id)}/signature`);
}
