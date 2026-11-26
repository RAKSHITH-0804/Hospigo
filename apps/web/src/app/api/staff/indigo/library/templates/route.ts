import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/indigo/library/templates: a new library template (copy or preset). */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/indigo/library/templates');
}
