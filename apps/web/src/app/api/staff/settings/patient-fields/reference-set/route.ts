import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/settings/patient-fields/reference-set: add the ready-made reference fields that are not there yet. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/patient-fields/reference-set');
}
