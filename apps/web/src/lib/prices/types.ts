/** Prices screen (Step 8b, part B): the shapes of the API answers and the route paths. */

export const API_PRICES = '/opd/prices';

export const PRICES_ROUTES = {
  list: '/api/staff/opd/prices',
  history: '/api/staff/opd/prices/history',
  items: '/api/staff/opd/prices/items',
  doctorFees: '/api/staff/opd/prices/doctor-fees',
} as const;

export const PRICE_KINDS = ['REGISTRATION', 'INVESTIGATION', 'DOCTOR_FEE'] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export type PriceVisitType = 'NEW' | 'FOLLOW_UP';

export type PriceRow = {
  key: string;
  kind: PriceKind;
  itemId: string | null;
  doctorProfileId: string | null;
  visitType: PriceVisitType | null;
  code: string;
  name: string;
  currentAmountPaise: number | null;
  currentFrom: string | null;
  nextAmountPaise: number | null;
  nextFrom: string | null;
  /** A follow-up fee row with no separate follow-up fee: it costs the same as the new-visit fee. */
  followsBase: boolean;
  /**
   * Doctor fees: where the fee shown comes from (Step 9). BRANCH = set for the active branch,
   * HOSPITAL = the doctor's hospital-wide fee, null or missing = no fee yet / not a doctor fee.
   */
  feeScope?: 'BRANCH' | 'HOSPITAL' | null;
};

export type PricesResponse = {
  items: PriceRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Today in the hospital time zone (YYYY-MM-DD). */
  today: string;
  /** True when the caller may set a doctor's hospital-wide fee (a hospital-wide Admin). */
  canSetHospitalWide?: boolean;
};

export type PriceVersion = {
  id: string;
  amountPaise: number;
  effectiveFrom: string;
  createdAt: string;
  createdByName: string | null;
  inEffect: boolean;
};

export type PriceHistoryResponse = { items: PriceVersion[] };

export type PriceChangeResponse = {
  changed: boolean;
  previousAmountPaise: number | null;
  price: { id: string; amountPaise: number; effectiveFrom: string };
};
