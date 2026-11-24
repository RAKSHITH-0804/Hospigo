import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/settings/vitals-fields/reorder: put all the vitals fields in the given order. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/vitals-fields/reorder');
}
