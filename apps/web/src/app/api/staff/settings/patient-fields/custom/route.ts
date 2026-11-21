import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/settings/patient-fields/custom: add a field of the hospital to the form. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/patient-fields/custom');
}
