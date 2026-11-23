import { NextResponse } from 'next/server';
import { staffRoute } from '@/lib/auth/staff-route';

type Context = { params: Promise<{ type: string }> };

const TYPES = ['TESTS', 'DOCTOR_FEES', 'MEDICINES'];

/** GET /api/staff/imports/templates/:type: the sample Excel file for one kind of list. */
export async function GET(_request: Request, context: Context) {
  const { type } = await context.params;
  if (!TYPES.includes(type)) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return staffRoute({
    method: 'GET',
    path: `/imports/templates/${type}`,
    download: {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${type.toLowerCase()}-template.xlsx`,
    },
  });
}
