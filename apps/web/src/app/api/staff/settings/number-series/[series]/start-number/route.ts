import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ series: string }> };

/** PUT /api/staff/settings/number-series/:series/start-number: raise the counter (never lowers it). */
export async function PUT(request: Request, context: Context) {
  const { series } = await context.params;
  return proxyOpdWrite(
    request,
    'PUT',
    `/settings/number-series/${encodeURIComponent(series)}/start-number`,
  );
}
