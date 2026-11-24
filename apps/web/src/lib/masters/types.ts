/** What the masters screens' API answers (Step 8c). The API checks every value. */

export type PaymentModeRow = {
  id: string;
  code: string;
  name: string;
  requiresReference: boolean;
  active: boolean;
  /** The mode billing uses when none is chosen: it cannot be switched off. */
  isDefault: boolean;
  paymentsCount: number;
};

export type PaymentModesResponse = { items: PaymentModeRow[] };

export type VitalsFieldRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  valueKind: 'NUMBER' | 'TEXT';
  displayOrder: number;
  warnMin: number | null;
  warnMax: number | null;
  active: boolean;
  readingsCount: number;
};

export type VitalsFieldsResponse = { items: VitalsFieldRow[] };

/** API path (server side) and the Next route handlers that proxy it (browser side). */
export const API_PAYMENT_MODES = '/settings/payment-modes';
export const API_VITALS_FIELDS = '/settings/vitals-fields';
export const MASTERS_ROUTES = {
  paymentModes: '/api/staff/settings/payment-modes',
  vitalsFields: '/api/staff/settings/vitals-fields',
  numberSeries: '/api/staff/settings/number-series',
} as const;

export type SeriesKind = 'BILL' | 'RECEIPT' | 'REFUND';

export type SeriesRow = {
  series: SeriesKind;
  configured: boolean;
  /** False when the stored format has another shape than the screen makes: shown, not edited. */
  editable: boolean;
  prefix: string;
  separator: string;
  fyStyle: 'SHORT' | 'LONG';
  width: number;
  resetRule: 'NEVER' | 'FINANCIAL_YEAR';
  fyStartMonth: number;
  /** A number of the series exists: the reset rule and the financial year start can no longer change. */
  locked: boolean;
  lastNumber: string;
  next: string;
};

export type SeriesResponse = { items: SeriesRow[]; today: string };

export const API_NUMBER_SERIES = '/settings/number-series';
