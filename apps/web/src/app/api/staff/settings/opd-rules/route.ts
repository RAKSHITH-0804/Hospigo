import { proxyOpdWrite } from '@/lib/opd/route-write';

/** PUT /api/staff/settings/opd-rules: the API checks the permission, the module and every number. */
export async function PUT(request: Request) {
  return proxyOpdWrite(request, 'PUT', '/settings/opd-rules');
}
