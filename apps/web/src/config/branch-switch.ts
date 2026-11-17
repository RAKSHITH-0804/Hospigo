/**
 * Single source for the branch switcher (Step 3d) on the web side:
 * route paths, the write-guard header, limits and the upstream message the API uses.
 * Shared by route handlers and client code, so it holds no secrets and reads no env
 * (browser code cannot read non-NEXT_PUBLIC variables).
 */
export const branchSwitchConfig = {
  /** Header every browser write carries: the branch id that page was rendered for. */
  headerName: 'x-hospigo-branch',
  /** Same cap as the API DTO for branchId. */
  branchIdMaxLength: 64,
  /** Do not ask the server again about the active branch more often than this (focus bursts). */
  recheckMinIntervalMs: 2000,
  /** HTTP status the single-flight returns when a different switch is already running. */
  conflictStatus: 409,
  /** Exact Nest message for "already on that branch" (maps to SAME_BRANCH). */
  upstreamSameBranchMessage: 'Branch is already active',
  endpoints: {
    switchBranch: '/api/auth/switch-branch',
    activeBranch: '/api/auth/active-branch',
    branches: '/api/staff/branches',
  },
} as const;

export const BranchSwitchErrorCode = {
  FORBIDDEN: 'FORBIDDEN',
  BRANCH_NOT_AVAILABLE: 'BRANCH_NOT_AVAILABLE',
  SAME_BRANCH: 'SAME_BRANCH',
  SWITCH_IN_PROGRESS: 'SWITCH_IN_PROGRESS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAVAILABLE: 'UNAVAILABLE',
  VALIDATION: 'VALIDATION',
  UNKNOWN: 'UNKNOWN',
} as const;

export type BranchSwitchErrorCode =
  (typeof BranchSwitchErrorCode)[keyof typeof BranchSwitchErrorCode];

/** Returned by staff write routes when the page's branch differs from the session's. */
export const BRANCH_CHANGED_CODE = 'BRANCH_CHANGED';
