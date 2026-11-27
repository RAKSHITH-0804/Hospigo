import { staffRoute } from '@/lib/auth/staff-route';

type Params = { params: Promise<{ id: string }> };

/** GET /api/staff/print-library/templates/:id: one assigned design, to look at before choosing it. */
export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  return staffRoute({ method: 'GET', path: `/print-library/templates/${encodeURIComponent(id)}` });
}
