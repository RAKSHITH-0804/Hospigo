/** The daily collection report as the API sends it (Step 7-1). Money is whole paise. */
export type CollectionRow = {
  key: string;
  name: string;
  payments: number;
  refunds: number;
  collectedPaise: number;
  refundedPaise: number;
  netPaise: number;
  /** Only on the doctor and branch rows. */
  visits?: number;
};

/** Tests billed that day (a test line of an investigations bill): how many and the billed amount. */
export type TestRow = { key: string; name: string; count: number; billedPaise: number };

export type DailyCollectionReport = {
  date: string;
  timezone: string;
  branches: Array<{ id: string; code: string; name: string }>;
  combined: boolean;
  totals: {
    payments: number;
    refunds: number;
    collectedPaise: number;
    refundedPaise: number;
    netPaise: number;
  };
  counts: { visits: number; visitsCancelled: number; bills: number };
  byMode: CollectionRow[];
  byDoctor: CollectionRow[];
  byBillType: CollectionRow[];
  /** "(none)" is a doctor without a department. */
  byDepartment: CollectionRow[];
  byTest: TestRow[];
  byBranch: CollectionRow[];
  /** `matches` is null when a filter is on: the ledger has no such split to compare with. */
  ledger: { paymentPaise: number; refundPaise: number; matches: boolean | null };
  /** The filters that were applied. */
  filters: Record<string, string>;
};

/** What the dropdowns of the report screen offer (all of it this hospital's own). */
export type ReportFilterOptions = {
  branches: Array<{ id: string; code: string; name: string }>;
  activeBranchId: string;
  canAllBranches: boolean;
  doctors: Array<{ code: string; name: string }>;
  paymentModes: Array<{ code: string; name: string }>;
  departments: string[];
  billTypes: string[];
  tests: Array<{ code: string; name: string }>;
};
