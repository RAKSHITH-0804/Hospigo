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
} as const;
