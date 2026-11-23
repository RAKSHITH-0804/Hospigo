/** Excel upload screen (Step 8b, part C): the shapes of the API answers and the route paths. */

export const API_IMPORTS = '/imports';

export const IMPORT_ROUTES = {
  list: '/api/staff/imports',
  one: '/api/staff/imports',
  template: '/api/staff/imports/templates',
} as const;

export const IMPORT_TYPES = ['TESTS', 'DOCTOR_FEES', 'MEDICINES'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
/** The lists that change prices (they need the price permission as well). */
export const IMPORT_PRICE_TYPES: readonly ImportType[] = ['TESTS', 'DOCTOR_FEES'];

export type ImportBatch = {
  id: string;
  type: ImportType;
  status: 'DRAFT' | 'PREVIEWED' | 'APPROVED' | 'POSTED' | 'UNDONE' | 'FAILED';
  runStatus: string | null;
  runStale: boolean;
  fileName: string;
  totalRows: number;
  validRows: number;
  exceptionRows: number;
  unchangedRows: number;
  postedRows: number;
  errorMessage: string | null;
  createdAt: string;
  createdByName: string | null;
  approvedAt: string | null;
  postedAt: string | null;
};

export type ImportListResponse = {
  items: ImportBatch[];
  total: number;
  page: number;
  pageSize: number;
};

export type ImportRow = {
  rowNumber: number;
  matchKey: string;
  status: string;
  action: string | null;
  values: Record<string, string | number | boolean | null>;
  reason: string | null;
  field: string | null;
};

export type ImportRowsResponse = {
  items: ImportRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type ImportAction = 'approve' | 'post' | 'cancel';
