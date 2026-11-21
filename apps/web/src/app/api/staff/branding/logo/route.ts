import { proxyPictureUpload } from '@/lib/images/route-upload';

/** PUT /api/staff/branding/logo: upload the hospital logo (a hospital-wide Admin only; the API checks). */
export async function PUT(request: Request) {
  return proxyPictureUpload(request, '/settings/branding/logo');
}
