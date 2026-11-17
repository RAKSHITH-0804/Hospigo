import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionConfig } from '@/config/session';
import { readBranchIdFromAccessToken } from '@/lib/auth/access-claims';

/**
 * GET /api/auth/active-branch -> { activeBranchId: string | null }
 *
 * Tells a tab which branch the SHARED session cookie currently holds (a switch in another tab
 * changes it for every tab). Cookie only: no API call, no token in the response. The id is read
 * without verification and is used by the page only to decide whether to reload itself.
 */
export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const access = jar.get(sessionConfig.cookieAccessName)?.value;
  const activeBranchId = access ? (readBranchIdFromAccessToken(access) ?? null) : null;
  return NextResponse.json({ activeBranchId }, { headers: { 'Cache-Control': 'no-store' } });
}
