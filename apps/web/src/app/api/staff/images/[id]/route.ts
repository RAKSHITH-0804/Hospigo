import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imageUploadConfig } from '@/config/images';
import { sessionConfig } from '@/config/session';
import { callStaffApi } from '@/lib/auth/staff-api';

type Context = { params: Promise<{ id: string }> };

const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Content-Disposition': 'inline',
} as const;

/**
 * GET /api/staff/images/:id: a picture (logo or signature) for an <img> on a screen or a print page.
 * The browser sends only its cookie; the access token is added here and never reaches the browser.
 * The API decides who may see it. Only PNG, JPEG and WebP are ever passed on, with their own type.
 */
export async function GET(_request: Request, context: Context) {
  const jar = await cookies();
  if (!jar.get(sessionConfig.cookieAccessName)?.value) {
    return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const { id } = await context.params;
  const result = await callStaffApi<ArrayBuffer>(`/images/${encodeURIComponent(id)}`, {
    method: 'GET',
    raw: true,
  });
  if (!result.ok) {
    const known = result.status === 401 || result.status === 403 || result.status === 404;
    const status = known ? result.status : 502;
    return NextResponse.json({ code: known ? 'NOT_AVAILABLE' : 'UNAVAILABLE' }, { status });
  }
  const type = (result.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(imageUploadConfig.shownTypes as readonly string[]).includes(type)) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 502 });
  }
  return new NextResponse(result.data, {
    status: 200,
    headers: {
      ...SAFE_HEADERS,
      'Content-Type': type,
      'Cache-Control': `private, max-age=${imageUploadConfig.cacheSeconds}, immutable`,
    },
  });
}
