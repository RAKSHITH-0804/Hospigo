import { proxyOpdWrite } from '@/lib/opd/route-write';

type Params = { params: Promise<{ id: string }> };

/** POST /api/staff/indigo/library/templates/:id/retire: take a template out of the library. */
export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  return proxyOpdWrite(
    request,
    'POST',
    `/indigo/library/templates/${encodeURIComponent(id)}/retire`,
  );
}
