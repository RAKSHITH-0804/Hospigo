import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/opd/queue: today's waiting visits (a doctor's own, or the branch for a nurse; optional doctorProfileId). */
export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : null;
  const query: Record<string, string> = {};
  if (params?.get('doctorProfileId')) {
    query.doctorProfileId = params.get('doctorProfileId')!;
  }
  if (params?.get('branch') === 'ALL') {
    query.branch = 'ALL';
  }
  return staffRoute({
    method: 'GET',
    path: '/opd/queue',
    query: Object.keys(query).length > 0 ? query : undefined,
  });
}
