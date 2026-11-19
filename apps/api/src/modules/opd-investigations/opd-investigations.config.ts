/** Tests ordered by the doctor and the investigations bill: limits in one place. */
export const OPD_INVESTIGATIONS_CONFIG = {
  /** Most tests one visit can hold (ordered, billed and not taken together). */
  maxTestsPerVisit: 30,
  searchDefaultLimit: 20,
  searchMaxLimit: 50,
  searchMaxLength: 100,
  reasonMaxLength: 500,
  /** Longest "pending tests" list one screen gets. */
  pendingMaxVisits: 100,
  idMaxLength: 64,
} as const;
