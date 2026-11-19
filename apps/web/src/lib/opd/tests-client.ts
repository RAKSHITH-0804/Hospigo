import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import type {
  ApprovePayload,
  BillTestsPayload,
  BillTestsResponse,
  PendingTestsResponse,
  RefundListResponse,
  RefundRequestResponse,
  RefundRequestStatus,
  RefundRequestView,
  RequestCancelPayload,
  RequestRefundPayload,
  SaveOrdersResponse,
  TestsSearchResponse,
  VisitTestsResponse,
} from './tests-types';

/** Next route handlers that proxy the tests and refunds API. Browsers never see tokens. */
export const OPD_TESTS_SEARCH_API = '/api/staff/opd/investigations/tests';
export const OPD_PENDING_TESTS_API = '/api/staff/opd/investigations/pending';
export const OPD_REFUND_REQUESTS_API = '/api/staff/opd/refund-requests';

/** The tests of one visit (orders, bills, receipts, refund requests) for reception. */
export function visitTestsPath(visitId: string): string {
  return `/app/opd/visits/${encodeURIComponent(visitId)}/tests`;
}

/** The printable receipt of one investigations bill. */
export function testsReceiptPath(visitId: string, billId: string): string {
  return `/app/opd/visits/${encodeURIComponent(visitId)}/tests/${encodeURIComponent(billId)}/receipt`;
}

const visitApi = (visitId: string, tail: string): string =>
  `/api/staff/opd/visits/${encodeURIComponent(visitId)}${tail}`;
const requestApi = (id: string, tail = ''): string =>
  `${OPD_REFUND_REQUESTS_API}/${encodeURIComponent(id)}${tail}`;

export function searchTests(
  q: string,
  limit: number,
  signal?: AbortSignal,
): Promise<PatientsApiResult<TestsSearchResponse>> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return patientsApi<TestsSearchResponse>(`${OPD_TESTS_SEARCH_API}?${params.toString()}`, {
    signal,
  });
}

/** The doctor's list of tests for the visit (replaces the tests still only ordered). */
export function saveTestOrders(
  visitId: string,
  chargeItemIds: string[],
): Promise<PatientsApiResult<SaveOrdersResponse>> {
  return patientsApi<SaveOrdersResponse>(visitApi(visitId, '/investigations'), {
    method: 'PUT',
    body: { chargeItemIds },
  });
}

export function loadVisitTests(visitId: string): Promise<PatientsApiResult<VisitTestsResponse>> {
  return patientsApi<VisitTestsResponse>(visitApi(visitId, '/investigations'));
}

export function loadPendingTests(
  signal?: AbortSignal,
): Promise<PatientsApiResult<PendingTestsResponse>> {
  return patientsApi<PendingTestsResponse>(OPD_PENDING_TESTS_API, { signal });
}

/** Bill the tests the patient will take. One idempotency key per attempt; the caller keeps it on retries. */
export function billTests(
  visitId: string,
  payload: BillTestsPayload,
): Promise<PatientsApiResult<BillTestsResponse>> {
  return patientsApi<BillTestsResponse>(visitApi(visitId, '/investigation-bills'), {
    method: 'POST',
    body: payload,
  });
}

export function requestRefund(
  billId: string,
  payload: RequestRefundPayload,
): Promise<PatientsApiResult<RefundRequestResponse>> {
  return patientsApi<RefundRequestResponse>(
    `/api/staff/opd/bills/${encodeURIComponent(billId)}/refund-requests`,
    { method: 'POST', body: payload },
  );
}

export function requestCancel(
  visitId: string,
  payload: RequestCancelPayload,
): Promise<PatientsApiResult<RefundRequestResponse>> {
  return patientsApi<RefundRequestResponse>(visitApi(visitId, '/cancel-requests'), {
    method: 'POST',
    body: payload,
  });
}

export function buildRefundListPath(args: {
  status?: RefundRequestStatus;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  if (args.status) {
    params.set('status', args.status);
  }
  params.set('page', String(args.page));
  params.set('pageSize', String(args.pageSize));
  return `${OPD_REFUND_REQUESTS_API}?${params.toString()}`;
}

export function loadRefundRequests(
  args: { status?: RefundRequestStatus; page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<PatientsApiResult<RefundListResponse>> {
  return patientsApi<RefundListResponse>(buildRefundListPath(args), { signal });
}

export function loadRefundRequest(id: string): Promise<PatientsApiResult<RefundRequestView>> {
  return patientsApi<RefundRequestView>(requestApi(id));
}

export function approveRefund(
  id: string,
  payload: ApprovePayload,
): Promise<PatientsApiResult<RefundRequestResponse>> {
  return patientsApi<RefundRequestResponse>(requestApi(id, '/approve'), {
    method: 'POST',
    body: payload,
  });
}

export function rejectRefund(
  id: string,
  note: string,
): Promise<PatientsApiResult<RefundRequestResponse>> {
  return patientsApi<RefundRequestResponse>(requestApi(id, '/reject'), {
    method: 'POST',
    body: { note },
  });
}
