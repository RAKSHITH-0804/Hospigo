import { staffRoute } from '@/lib/auth/staff-route';

type Context = { params: Promise<{ id: string }> };

/** GET /api/staff/opd/doctors/:id/availability: switch, timetable and leave of one doctor (the API decides who may see it). */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return staffRoute({
    method: 'GET',
    path: `/opd/doctors/${encodeURIComponent(id)}/availability`,
  });
}
