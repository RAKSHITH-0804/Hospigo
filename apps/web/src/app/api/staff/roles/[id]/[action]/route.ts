import { NextResponse } from 'next/server';
import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string; action: string }> };

const ACTIONS = ['deactivate', 'reactivate'];

/** POST /api/staff/roles/:id/:action: switch a role nobody holds off or on. Only these two are passed on. */
export async function POST(request: Request, context: Context) {
  const { id, action } = await context.params;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return proxyOpdWrite(request, 'POST', `/roles/${encodeURIComponent(id)}/${action}`);
}
