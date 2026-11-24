import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite } from '@/lib/opd/route-write';

/** GET /api/staff/doctor-profiles/me/leave-requests: the signed-in doctor's own requests. */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/doctor-profiles/me/leave-requests' });
}

/** POST: the doctor asks for leave (first and last day). The API finds the doctor from the token. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/doctor-profiles/me/leave-requests');
}
