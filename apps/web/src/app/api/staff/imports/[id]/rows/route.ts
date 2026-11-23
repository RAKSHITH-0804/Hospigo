import { staffRoute } from '@/lib/auth/staff-route';

type Context = { params: Promise<{ id: string }> };

/** GET /api/staff/imports/:id/rows: the rows of a batch (forwards status, page and pageSize). */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const key of ['status', 'page', 'pageSize'] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') {
      query[key] = value;
    }
  }
  return staffRoute({ method: 'GET', path: `/imports/${encodeURIComponent(id)}/rows`, query });
}
