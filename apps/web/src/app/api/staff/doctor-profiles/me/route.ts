import { proxyOpdWrite } from '@/lib/opd/route-write';

/**
 * PUT /api/staff/doctor-profiles/me: a doctor saves their own details. The API finds the profile
 * from the signed-in user (never from this request) and checks the permission and every value.
 */
export async function PUT(request: Request) {
  return proxyOpdWrite(request, 'PUT', '/doctor-profiles/me');
}
