import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/doctor-profiles/me/signature/remove: a doctor stops using their signature picture. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/doctor-profiles/me/signature/remove');
}
