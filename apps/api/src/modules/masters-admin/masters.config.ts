/** Limits, patterns and audit names of the masters screens (Step 8c). */
export const MASTERS_CONFIG = {
  idPattern: /^[A-Za-z0-9_-]{1,64}$/,
  // payment modes
  paymentModeCodePattern: /^[A-Z][A-Z0-9_]{1,19}$/,
  paymentModeNameMax: 40,
  paymentModesMax: 30,
  /** The mode the billing screens use when none is chosen: it can never be switched off. */
  defaultPaymentModeCode: 'CASH',
  // vitals fields
  vitalsCodePattern: /^[a-z][a-z0-9_]{1,29}$/,
  vitalsNameMax: 40,
  vitalsUnitMax: 12,
  vitalsMax: 30,
  warnLimitMax: 100000,
} as const;

export const MASTERS_AUDIT = {
  paymentMode: { action: 'PAYMENT_MODE_CHANGE', entityType: 'payment_modes' },
  vitalsField: { action: 'VITALS_FIELD_CHANGE', entityType: 'vitals_fields' },
  numberSeries: { action: 'NUMBER_SERIES_CHANGE', entityType: 'number_series_settings' },
} as const;
