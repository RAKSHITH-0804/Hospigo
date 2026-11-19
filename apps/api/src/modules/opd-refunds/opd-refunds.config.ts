/** Refund and cancellation requests: limits in one place. Money is always integer paise. */
export const OPD_REFUNDS_CONFIG = {
  reasonMaxLength: 500,
  noteMaxLength: 500,
  idMaxLength: 64,
  referenceMaxLength: 64,
  listDefaultPageSize: 20,
  listMaxPageSize: 100,
} as const;
