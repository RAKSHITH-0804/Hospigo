import { NextResponse } from 'next/server';
import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ step: string }> };

const STEPS = ['request', 'confirm'];

/** POST /api/staff/account/email/request|confirm: change my email with a code sent to the new address. */
export async function POST(request: Request, context: Context) {
  const { step } = await context.params;
  if (!STEPS.includes(step)) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return proxyOpdWrite(request, 'POST', `/account/email/${step}`);
}
