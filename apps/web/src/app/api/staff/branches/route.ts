import { staffRoute } from '@/lib/auth/staff-route';

/** GET /api/staff/branches: branches the caller may switch to (the API returns 403 for others). */
export async function GET() {
  return staffRoute({ method: 'GET', path: '/auth/switchable-branches' });
}
