import { NextResponse } from 'next/server';
import { proxyOpdWrite } from '@/lib/opd/route-write';

type Context = { params: Promise<{ id: string; action: string }> };

const ACTIONS = ['deactivate', 'reactivate', 'resend-invite', 'reset-password'];

/**
 * POST /api/staff/people/:id/:action: switch a person off or on, send the activation email again, or send a password reset link.
 * Only these four actions are passed on; the API decides who may do them.
 */
export async function POST(request: Request, context: Context) {
  const { id, action } = await context.params;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      { code: 'UNKNOWN' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return proxyOpdWrite(request, 'POST', `/staff/${encodeURIComponent(id)}/${action}`);
}
