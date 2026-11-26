import { proxyLibraryImage } from '@/lib/indigo/route-image';

type Params = { params: Promise<{ id: string }> };

/** GET /api/staff/print-library/logos/:id/image: the picture of an assigned logo. */
export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  return proxyLibraryImage(`/print-library/logos/${encodeURIComponent(id)}/image`);
}
