/** Behaviour numbers of the settings screens (one place, no magic numbers in components). */
export const settingsScreenConfig = {
  /** How long a "Saved." confirmation stays before it fades away. Errors stay until the next action. */
  savedMessageMs: 3000,
  /** Rows per page in the Admin leave requests pop-up. */
  leaveRequestsPageSize: 10,
} as const;

/** Behaviour numbers of the staff, roles and My profile screens. */
export const staffScreenConfig = {
  /** Wait after the last key press before the staff list is searched again. */
  searchDebounceMs: 300,
  /** Longest search text typed (the API cuts it at the same length). */
  searchMax: 80,
  /** How long "Your password is changed" shows before the person is signed out. */
  signOutDelayMs: 1500,
} as const;
