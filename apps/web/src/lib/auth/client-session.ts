import {
  BranchSwitchErrorCode,
  branchSwitchConfig,
  type BranchSwitchErrorCode as SwitchErrorCode,
} from '@/config/branch-switch';
import { staffCopy } from '@/config/staff-copy';

/**
 * Browser-side session helpers shared by every staff screen: the silent-renewal latch,
 * the branch switch, and the branch THIS tab was rendered for. Cookies only; no token here.
 */
export const AUTH_REFRESH_SESSION_API = '/api/auth/refresh-session';

export type SwitchableBranch = {
  id: string;
  name: string;
  isMain: boolean;
  isCurrent: boolean;
};

export type BranchSwitchResult = { ok: true } | { ok: false; code: SwitchErrorCode };
export type BranchListResult =
  { ok: true; branches: SwitchableBranch[] } | { ok: false; code: SwitchErrorCode };

// ---------------------------------------------------------------- active branch of this tab

let clientActiveBranchId: string | undefined;

/** Set by the shell from the server render; sent as the stale-tab guard header on writes. */
export function setClientActiveBranch(branchId: string | null | undefined): void {
  clientActiveBranchId = branchId ?? undefined;
}

export function getClientActiveBranch(): string | undefined {
  return clientActiveBranchId;
}

// -------------------------------------------------------------------- one latch for the tab

/** Shared in-flight promise so concurrent 401s trigger one refresh. */
let refreshInFlight: Promise<boolean> | null = null;
/** A switch rotates the same refresh token, so no refresh may start beside it. */
let switchInFlight: { branchId: string; promise: Promise<BranchSwitchResult> } | null = null;

/**
 * POST /api/auth/refresh-session (JSON, no redirect). Cookies only.
 * Concurrent callers share one request; while a switch runs, the caller waits for it instead
 * (the server answers both from one single-flight, so the cookies end up identical).
 */
export function refreshSessionOnce(): Promise<boolean> {
  if (switchInFlight) {
    return switchInFlight.promise.then((result) => result.ok);
  }
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(AUTH_REFRESH_SESSION_API, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Test-only: clear the client latches and the tab's branch. */
export function clearClientRefreshLatchForTests(): void {
  refreshInFlight = null;
  switchInFlight = null;
  clientActiveBranchId = undefined;
}

function isSwitchCode(value: unknown): value is SwitchErrorCode {
  return (
    typeof value === 'string' && (Object.values(BranchSwitchErrorCode) as string[]).includes(value)
  );
}

async function readCode(response: Response): Promise<SwitchErrorCode> {
  try {
    const body: unknown = await response.json();
    const code = (body as { code?: unknown } | null)?.code;
    if (isSwitchCode(code)) {
      return code;
    }
    // Staff routes answer 401 UNAUTHORIZED when the access cookie is gone: same meaning.
    if (code === 'UNAUTHORIZED') {
      return BranchSwitchErrorCode.SESSION_EXPIRED;
    }
  } catch {
    // fall through
  }
  return BranchSwitchErrorCode.UNKNOWN;
}

/** Make `branchId` the active branch. Runs once at a time; waits for a running refresh first. */
export function switchBranchOnce(branchId: string): Promise<BranchSwitchResult> {
  if (switchInFlight) {
    return switchInFlight.branchId === branchId
      ? switchInFlight.promise
      : Promise.resolve({ ok: false, code: BranchSwitchErrorCode.SWITCH_IN_PROGRESS });
  }
  const promise = (async (): Promise<BranchSwitchResult> => {
    try {
      if (refreshInFlight) {
        await refreshInFlight;
      }
      const response = await fetch(branchSwitchConfig.endpoints.switchBranch, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId }),
      });
      if (response.ok) {
        return { ok: true };
      }
      return { ok: false, code: await readCode(response) };
    } catch {
      return { ok: false, code: BranchSwitchErrorCode.UNAVAILABLE };
    } finally {
      switchInFlight = null;
    }
  })();
  switchInFlight = { branchId, promise };
  return promise;
}

/** Branches the caller may switch to. One silent renewal + one retry on an expired session. */
export async function fetchSwitchableBranches(retried = false): Promise<BranchListResult> {
  try {
    const response = await fetch(branchSwitchConfig.endpoints.branches, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const body: unknown = await response.json();
      return { ok: true, branches: Array.isArray(body) ? (body as SwitchableBranch[]) : [] };
    }
    if (response.status === 401 && !retried && (await refreshSessionOnce())) {
      return fetchSwitchableBranches(true);
    }
    return { ok: false, code: await readCode(response) };
  } catch {
    return { ok: false, code: BranchSwitchErrorCode.UNAVAILABLE };
  }
}

/** Which branch the shared session cookie holds right now (null = unknown, never an error). */
export async function fetchCookieBranchId(): Promise<string | null> {
  try {
    const response = await fetch(branchSwitchConfig.endpoints.activeBranch, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const id = (body as { activeBranchId?: unknown } | null)?.activeBranchId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Plain-words message for a switch / branch-list error code (copy lives in staff-copy). */
export function branchErrorMessageFor(code: string): string {
  switch (code) {
    case BranchSwitchErrorCode.FORBIDDEN:
      return staffCopy.errors.forbidden;
    case BranchSwitchErrorCode.BRANCH_NOT_AVAILABLE:
      return staffCopy.errors.branchNotAvailable;
    case BranchSwitchErrorCode.SAME_BRANCH:
      return staffCopy.errors.branchAlreadyActive;
    case BranchSwitchErrorCode.SWITCH_IN_PROGRESS:
      return staffCopy.errors.branchSwitchBusy;
    case BranchSwitchErrorCode.SESSION_EXPIRED:
      return staffCopy.errors.sessionExpired;
    case BranchSwitchErrorCode.RATE_LIMITED:
      return staffCopy.errors.branchSwitchRateLimited;
    case BranchSwitchErrorCode.UNAVAILABLE:
      return staffCopy.errors.unreachable;
    default:
      return staffCopy.errors.tryAgain;
  }
}
