import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ key: string }> };

/** PUT /api/staff/settings/patient-fields/builtin/:key (the key is encoded; the API knows the list). */
export async function PUT(request: Request, context: Context) {
  const { key } = await context.params;
  return proxyOpdWrite(
    request,
    'PUT',
    `/settings/patient-fields/builtin/${encodeURIComponent(key)}`,
  );
}
