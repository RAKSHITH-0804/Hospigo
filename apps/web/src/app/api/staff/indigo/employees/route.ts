import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/indigo/employees: the Indigo Owner creates an Employee. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/indigo/employees');
}
