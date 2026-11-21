import { proxyOpdWrite } from '@/lib/opd/route-write';

/** POST /api/staff/branding/logo/remove: stop using the logo (the old picture stays on record). */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/branding/logo/remove');
}
