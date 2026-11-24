import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite } from '@/lib/opd/route-write';

/** GET /api/staff/settings/payment-modes: all payment modes (the API checks the permission). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/settings/payment-modes' });
}

/** POST /api/staff/settings/payment-modes: add a payment mode. */
export async function POST(request: Request) {
  return proxyOpdWrite(request, 'POST', '/settings/payment-modes');
}
