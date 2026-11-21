import { proxyPictureUpload } from '@/lib/images/route-upload';

/** PUT /api/staff/doctor-profiles/me/signature: a doctor uploads their own signature or stamp picture. */
export async function PUT(request: Request) {
  return proxyPictureUpload(request, '/doctor-profiles/me/signature');
}
