import { staffRoute } from '@/lib/auth/staff-route';

type Params = { params: Promise<{ id: string }> };

/** GET /api/staff/patients/:id/clinical-history: the whole history of one patient, read-only (viewing is logged). */
export async function GET(_request: Request, context: Params) {
  const { id } = await context.params;
  return staffRoute({
    method: 'GET',
    path: `/patients/${encodeURIComponent(id)}/clinical-history`,
  });
}
