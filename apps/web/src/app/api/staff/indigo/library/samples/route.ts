import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/indigo/library/samples: add the designed samples that are missing. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/indigo/library/samples');
}
