/** Shapes aligned with docs/reference/api-opd.md (Visits and billing, Step 4a). Money is whole paise. */

export type VisitType = 'NEW' | 'FOLLOW_UP';

export type OpdDoctor = {
  id: string;
  code: string;
  name: string;
  department: string | null;
  available: boolean;
  unavailableReason: 'SWITCH_OFF' | 'ON_LEAVE' | null;
  outsideTimings: boolean;
  feeNewPaise: number | null;
  feeFollowUpPaise: number | null;
};

export type OpdDoctorsResponse = { items: OpdDoctor[] };

export type PreviewLine = {
  kind: 'CONSULTATION' | 'REGISTRATION' | 'INVESTIGATION';
  code: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  pricingNote: string | null;
};

export type VisitPreview = {
  visitType: VisitType;
  visitDate: string;
  doctor: { id: string; code: string; name: string };
  lines: PreviewLine[];
  totalPaise: number;
  followUpFree: boolean;
  repeatVisitFree: boolean;
  registrationIncluded: boolean;
  sameDayVisitWithDoctor: boolean;
};

export type BillLineView = PreviewLine & { lineNo: number; taxPaise: number };

/** One active payment mode of the hospital (no internal ids). */
export type PaymentMode = { code: string; name: string; requiresReference: boolean };

export type PaymentModesResponse = {
  items: PaymentMode[];
  defaultCode: string | null;
  /** Most payment rows one receipt may carry (from the API, never hardcoded here). */
  maxLines: number;
};

/** One line of a split payment as the API takes it. */
export type PaymentLinePayload = {
  paymentModeCode: string;
  amountPaise: number;
  referenceNo?: string;
};

/** One receipt (a split payment is ONE receipt with several payments). */
export type ReceiptView = { receiptNumber: string; totalPaise: number; issuedAt: string };

export type PaymentView = {
  id: string;
  receiptNumber: string;
  amountPaise: number;
  paymentMode: { code: string; name: string };
  referenceNo: string | null;
  paidAt: string;
};

export type BillView = {
  id: string;
  billNumber: string;
  billType: string;
  billDate: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  refundedPaise: number;
  paymentStatus: 'UNPAID' | 'PART_PAID' | 'PAID';
  lines?: BillLineView[];
  receipts?: ReceiptView[];
  payments?: PaymentView[];
};

export type VisitView = {
  id: string;
  status: 'AWAITING_PAYMENT' | 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED';
  visitType: VisitType;
  visitDate: string;
  branch: { id: string; name: string };
  patient: {
    id: string;
    uhid: string;
    name: string;
    gender: string | null;
    dobIsEstimated: boolean;
    ageYears: number | null;
    age: { years: number; months: number; days: number } | null;
  };
  doctor: { id: string; code: string; name: string };
  previousVisitId: string | null;
  token: { date: string; no: number; label: string } | null;
  queuedAt: string | null;
  createdAt: string;
  /** What the patient told reception (editable until the doctor starts) and who billed the visit. */
  receptionSymptoms?: string | null;
  createdByName?: string;
  /** The hospital's setting: show the patient card button after payment (single visit read only). */
  patientCardAutoPrint?: boolean;
  /** Absent for callers without opd.billing.read. */
  bill?: BillView | null;
  replayed?: boolean;
};

export type VisitListResponse = {
  items: VisitView[];
  total: number;
  page: number;
  pageSize: number;
};

/** What the patient record's Visits and Bills tabs receive from the page. */
export type VisitsTabData =
  | { status: 'ok'; data: VisitListResponse }
  | { status: 'noAccess' }
  | { status: 'error'; message: string };

/** pricingNote the API puts on a consultation line made free by the repeat-visit window. */
export const REPEAT_VISIT_NOTE = 'REPEAT_VISIT_FREE_WINDOW';
