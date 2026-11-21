import { proxyOpdWrite } from '@/lib/opd/route-write';

/** PUT /api/staff/people/code-format: change how new staff codes are made (a hospital-wide Admin only; the API checks). */
export async function PUT(request: Request) {
  return proxyOpdWrite(request, 'PUT', '/staff/code-format');
}
