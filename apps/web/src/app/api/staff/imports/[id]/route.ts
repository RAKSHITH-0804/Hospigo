import { staffRoute } from '@/lib/auth/staff-route';

type Context = { params: Promise<{ id: string }> };

/** GET /api/staff/imports/:id: one batch and its status. */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return staffRoute({ method: 'GET', path: `/imports/${encodeURIComponent(id)}` });
}
