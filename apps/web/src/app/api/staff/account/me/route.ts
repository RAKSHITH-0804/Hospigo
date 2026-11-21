import { proxyOpdWrite } from '@/lib/opd/route-write';

/** PUT /api/staff/account/me: a person changes their own name and phone (found from the token, never from this request). */
export async function PUT(request: Request) {
  return proxyOpdWrite(request, 'PUT', '/account/me');
}
