import { proxyLibraryImage } from '@/lib/indigo/route-image';

type Params = { params: Promise<{ id: string }> };

/** GET /api/staff/indigo/library/logos/:id/image: the picture of a library logo (Indigo Owner). */
export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  return proxyLibraryImage(`/indigo/library/logos/${encodeURIComponent(id)}/image`);
}
