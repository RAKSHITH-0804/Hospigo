import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/queue: today's waiting visits (a doctor's own, or the branch for a nurse; optional doctorProfileId). */
export async function GET(request?: Request) {
  const doctor = request ? new URL(request.url).searchParams.get('doctorProfileId') : null;
  return staffRoute({
    method: 'GET',
    path: '/opd/queue',
    query: doctor ? { doctorProfileId: doctor } : undefined,
  });
}
