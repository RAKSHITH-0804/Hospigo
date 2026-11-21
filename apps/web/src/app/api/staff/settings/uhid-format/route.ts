import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/settings/uhid-format: start a new patient number format. The API checks it all. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/uhid-format');
}
