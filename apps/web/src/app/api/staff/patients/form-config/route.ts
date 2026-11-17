import { staffRoute } from '@/lib/auth/staff-route';

export async function GET() {
  return staffRoute({
    method: 'GET',
    path: '/patients/form-config',
  });
}
