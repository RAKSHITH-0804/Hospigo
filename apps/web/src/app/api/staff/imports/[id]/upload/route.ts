import { NextResponse } from 'next/server';
import { proxyListUpload } from '@/lib/imports/route-upload';

type Context = { params: Promise<{ id: string }> };

const TYPES = ['TESTS', 'DOCTOR_FEES', 'MEDICINES'];

/** POST /api/staff/imports/:type/upload: upload one Excel file (the segment is the kind of list). */
export async function POST(request: Request, context: Context) {
  const { id: type } = await context.params;
  if (!TYPES.includes(type)) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return proxyListUpload(request, `/imports/${type}/upload`);
}
