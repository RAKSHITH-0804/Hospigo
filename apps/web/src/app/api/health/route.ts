import { NextResponse } from 'next/server';
import { requireApiInternalUrl } from '@/config/session';
import { getSession } from '@/lib/auth/session';

export type StorageHealthResponse = {
  status: string;
};

/**
 * HQ-only storage/liveness probe for the admin UI.
 * Calls API GET /health and returns only `{ status }` — never /health/details.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.kind !== 'HQ') {
    return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const base = requireApiInternalUrl();
  let response: Response;
  try {
    response = await fetch(`${base}/health`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ code: 'UNAVAILABLE' }, { status: 503 });
  }
  if (!response.ok) {
    return NextResponse.json({ code: 'UNAVAILABLE' }, { status: response.status });
  }
  const data = (await response.json()) as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : 'ok';
  const body: StorageHealthResponse = { status };
  return NextResponse.json(body);
}
