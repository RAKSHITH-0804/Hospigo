/** What the extra print values API answers (Step 8c). The API checks every value and permission. */

export type PrintValueScope = 'BRANCH' | 'HOSPITAL';

export type PrintValueRow = {
  id: string;
  key: string;
  /** The name of the value inside a template (value.<key>). */
  field: string;
  label: string;
  value: string;
  active: boolean;
  scope: PrintValueScope;
};

export type PrintValuesManageResponse = {
  items: PrintValueRow[];
  /** What the caller may change: the values of this branch, and the hospital's. */
  canChange: { branch: boolean; hospital: boolean };
  limits: { keyMax: number; labelMax: number; valueMax: number; perScopeMax: number };
};

/** One value that applies to the signed-in branch (what a print page and the designer list use). */
export type EffectivePrintValue = { key: string; field: string; label: string; text: string };
export type EffectivePrintValuesResponse = { items: EffectivePrintValue[] };

export const API_PRINT_VALUES = '/print-values';
export const API_PRINT_VALUES_MANAGE = '/print-values/manage';

export const PRINT_VALUE_ROUTES = {
  /** The browser routes: list (manage view), add, change. */
  all: '/api/staff/print-values',
} as const;
