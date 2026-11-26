import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/indigo/hospitals: the Indigo Owner onboards a hospital. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/indigo/hospitals');
}
