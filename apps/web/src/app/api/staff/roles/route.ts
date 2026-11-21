import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/roles: make a role by choosing permissions (a hospital-wide Admin only; the API checks). */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/roles');
}
