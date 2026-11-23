import { NextResponse } from 'next/server';
import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string; action: string }> };

const ACTIONS = ['approve', 'post', 'cancel'];

/** POST /api/staff/imports/:id/:action: approve, post or cancel a batch (the API decides who may). */
export async function POST(request: Request, context: Context) {
  const { id, action } = await context.params;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return proxyOpdWrite(request, 'POST', `/imports/${encodeURIComponent(id)}/${action}`);
}
