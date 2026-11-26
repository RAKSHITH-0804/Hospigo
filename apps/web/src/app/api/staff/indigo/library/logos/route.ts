import { proxyPictureUpload } from '@/lib/images/route-upload';

/** POST /api/staff/indigo/library/logos?name=...: add a logo to the library (PNG or JPEG). */
export async function POST(request: Request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  return proxyPictureUpload(request, '/indigo/library/logos', { method: 'POST', query: { name } });
}
