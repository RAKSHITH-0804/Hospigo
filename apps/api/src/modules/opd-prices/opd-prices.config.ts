/** Step 8b, part B: price change. No UI text here (the web has its own copy file). */
export const OPD_PRICES_CONFIG = {
  listDefaultPageSize: 25,
  listMaxPageSize: 100,
  /** The longest search text that is used. */
  searchMaxLength: 60,
  /** How many versions the history of one price shows. */
  historyLimit: 50,
  idPattern: /^[A-Za-z0-9_-]{1,64}$/,
} as const;

export const PRICE_KINDS = ['REGISTRATION', 'INVESTIGATION', 'DOCTOR_FEE'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export const VISIT_TYPES = ['NEW', 'FOLLOW_UP'] as const;
export type PriceVisitType = (typeof VISIT_TYPES)[number];

/** Audit action names (ids and amounts only, never free text). */
export const PRICE_AUDIT = {
  chargeItemPriceChanged: 'OPD_PRICE_CHANGE',
  doctorFeeChanged: 'OPD_DOCTOR_FEE_CHANGE',
} as const;
