/**
 * Reads the branch id out of the staff access token WITHOUT verifying it.
 *
 * This is only used to COMPARE with the branch a page says it was rendered for
 * (stale-tab guard) and to tell a focused tab which branch the shared cookie holds.
 * It is never trusted for access decisions: the API verifies the token and decides.
 */
export function readBranchIdFromAccessToken(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) {
    return undefined;
  }
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (json && typeof json === 'object') {
      const branchId = (json as { branchId?: unknown }).branchId;
      if (typeof branchId === 'string' && branchId.length > 0) {
        return branchId;
      }
    }
  } catch {
    // Not a JWT we can read: treated as "unknown branch".
  }
  return undefined;
}
