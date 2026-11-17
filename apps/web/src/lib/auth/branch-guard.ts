import { NextResponse } from 'next/server';
import { BRANCH_CHANGED_CODE, branchSwitchConfig } from '@/config/branch-switch';
import { readBranchIdFromAccessToken } from './access-claims';

/**
 * Stale-tab guard for browser WRITES. Tabs share one cookie, so after a branch switch in tab A,
 * tab B still shows the old branch while its requests would carry the new one. Every write
 * therefore carries the branch the page was rendered for; if it differs from the branch in the
 * session cookie (or is missing) the write is refused with 409 BRANCH_CHANGED and nothing reaches
 * the API. The API stays the only authority for access; this only prevents a wrong-branch write.
 */
export function checkBranchGuard(
  request: Request | undefined,
  accessToken: string,
): NextResponse | null {
  const claimed = request?.headers.get(branchSwitchConfig.headerName)?.trim();
  const actual = readBranchIdFromAccessToken(accessToken);
  if (claimed && actual && claimed === actual) {
    return null;
  }
  return NextResponse.json(
    { code: BRANCH_CHANGED_CODE },
    { status: branchSwitchConfig.conflictStatus, headers: { 'Cache-Control': 'no-store' } },
  );
}
