/** OPD reports: limits and names in one place. Money is always integer paise. */
export const OPD_REPORTS_CONFIG = {
  /** Earliest day a report can be asked for (the product did not exist before). */
  earliestDate: '2020-01-01',
  /** The only value `branch` may take: the combined report of every branch (hospital-wide access). */
  allBranches: 'ALL',
  csvContentType: 'text/csv; charset=utf-8',
  /** Excel needs this mark to read a UTF-8 file correctly. */
  csvBom: '﻿',
  csvFileNamePrefix: 'collection-',
  /** Bill types a report can be narrowed to. */
  billTypes: ['CONSULTATION', 'INVESTIGATION'] as const,
  /** Tests offered in the dropdown (a hospital rarely has more; the list is cut here). */
  maxTestOptions: 2000,
  xlsxContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

export const OPD_REPORT_AUDIT = {
  viewed: 'OPD_REPORT_VIEW',
  exported: 'OPD_REPORT_EXPORT',
} as const;
