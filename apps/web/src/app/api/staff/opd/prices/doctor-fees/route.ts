import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/opd/prices/doctor-fees: a new doctor fee (new or follow-up visits). */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/opd/prices/doctor-fees');
}
