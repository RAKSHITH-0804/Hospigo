import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/settings/number-series: the bill, receipt and refund number series (the API checks who may). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/settings/number-series' });
}
