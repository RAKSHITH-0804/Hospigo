import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { callStaffApi } from '@/lib/auth/staff-api';

const SHOWN = ['image/png', 'image/jpeg'];

/** A library logo for an <img>: the access token is added here and never reaches the browser. */
export async function proxyLibraryImage(path: string): Promise<NextResponse> {
  const jar = await cookies();
  if (!jar.get(sessionConfig.cookieAccessName)?.value) {
    return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const result = await callStaffApi<ArrayBuffer>(path, { method: 'GET', raw: true });
  if (!result.ok) {
    const known = result.status === 401 || result.status === 403 || result.status === 404;
    return NextResponse.json(
      { code: known ? 'NOT_AVAILABLE' : 'UNAVAILABLE' },
      { status: known ? result.status : 502 },
    );
  }
  const type = (result.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!SHOWN.includes(type)) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 502 });
  }
  return new NextResponse(result.data, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    },
  });
}
