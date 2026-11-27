/** Shapes aligned with docs/reference/api-opd.md ("Step 6a"). Money is whole paise. */
import type { BillView, PaymentLinePayload } from './types';

export type TestItem = { id: string; code: string; name: string };
export type TestsSearchResponse = { items: TestItem[] };

/** Statuses this version knows. The API may add more later (lab results): unknown ones are shown neutrally. */
export type KnownOrderStatus = 'ORDERED' | 'BILLED' | 'NOT_TAKEN';

export type OrderView = {
  id: string;
  chargeItemId: string;
  code: string;
  name: string;
  /** Kept as plain text on purpose: a new status must never break a screen. */
  status: string;
  notTakenReason: string | null;
  billNumber: string | null;
  orderedAt: string;
  resolvedAt: string | null;
};

export type SaveOrdersResponse = { orders: OrderView[] };

export type VisitTestsResponse = {
  visitId: string;
  visitStatus: string;
  orders: OrderView[];
  /** Investigations bills; present only for callers with opd.billing.read. */
  bills?: BillView[];
};

export type PendingOrder = {
  id: string;
  chargeItemId: string;
  code: string;
  name: string;
  /** The price in force now; null when the hospital has set none (the test cannot be billed). */
  pricePaise: number | null;
  orderedAt: string;
};

export type PendingVisit = {
  visitId: string;
  visitStatus: string;
  token: string | null;
  patient: { id: string; uhid: string; name: string };
  doctor: { code: string; name: string };
  orders: PendingOrder[];
  totalPaise: number;
};

export type PendingTestsResponse = { items: PendingVisit[] };

export type NotTakenPayload = { orderId: string; reason: string };

export type BillTestsPayload = {
  idempotencyKey: string;
  orderIds: string[];
  notTaken?: NotTakenPayload[];
  expectedTotalPaise?: number;
  payments?: PaymentLinePayload[];
};

export type BillTestsResponse = {
  replayed: boolean;
  visitId: string;
  bill: BillView;
  orders: OrderView[];
};

export type RefundRequestType = 'REFUND' | 'CANCEL_VISIT';
export type RefundRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';

export type RefundRequestView = {
  /** Only in the combined view (All my branches). */
  branchName?: string | null;
  id: string;
  type: RefundRequestType;
  status: RefundRequestStatus;
  amountPaise: number;
  reason: string;
  bill: {
    id: string;
    billNumber: string;
    billType: string;
    totalPaise: number;
    paidPaise: number;
    refundedPaise: number;
    refundablePaise: number;
  };
  visit: {
    id: string;
    status: string;
    token: string | null;
    consultationStarted: boolean;
    patient: { id: string; uhid: string; name: string };
    doctor: { code: string; name: string };
  };
  requestedBy: { id: string; name: string };
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The refund voucher number; present only when money was returned. */
  refundNumber: string | null;
  refunds: Array<{
    paymentMode: { code: string; name: string };
    amountPaise: number;
    referenceNo: string | null;
    refundedAt: string;
  }>;
};

export type RefundRequestResponse = { replayed: boolean; request: RefundRequestView };

export type RefundListResponse = {
  items: RefundRequestView[];
  total: number;
  page: number;
  pageSize: number;
};

export type RequestRefundPayload = { amountPaise: number; reason: string; idempotencyKey: string };
export type RequestCancelPayload = {
  reason: string;
  idempotencyKey: string;
  amountPaise?: number;
};
export type ApprovePayload = { references?: Record<string, string>; note?: string };
