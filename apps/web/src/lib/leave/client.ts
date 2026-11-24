import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import {
  LEAVE_ROUTES,
  type AdminLeaveRequest,
  type AdminLeaveRequestsResponse,
  type MyLeaveRequest,
  type MyLeaveRequestsResponse,
} from './types';

/** Browser calls to the Next route handlers for leave requests. Tokens never reach the browser. */

export const listMyLeaveRequests = (): Promise<PatientsApiResult<MyLeaveRequestsResponse>> =>
  patientsApi<MyLeaveRequestsResponse>(LEAVE_ROUTES.mine);

export const askForLeave = (
  fromDate: string,
  toDate: string,
): Promise<PatientsApiResult<MyLeaveRequest>> =>
  patientsApi<MyLeaveRequest>(LEAVE_ROUTES.mine, { method: 'POST', body: { fromDate, toDate } });

export const cancelMyLeaveRequest = (id: string): Promise<PatientsApiResult<MyLeaveRequest>> =>
  patientsApi<MyLeaveRequest>(`${LEAVE_ROUTES.mine}/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: {},
  });

export const listLeaveRequests = (query: {
  status: string;
  page: number;
  pageSize: number;
}): Promise<PatientsApiResult<AdminLeaveRequestsResponse>> =>
  patientsApi<AdminLeaveRequestsResponse>(
    `${LEAVE_ROUTES.admin}?status=${encodeURIComponent(query.status)}&page=${query.page}&pageSize=${query.pageSize}`,
  );

export const decideLeaveRequest = (
  id: string,
  decision: 'approve' | 'reject',
): Promise<PatientsApiResult<AdminLeaveRequest>> =>
  patientsApi<AdminLeaveRequest>(`${LEAVE_ROUTES.admin}/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    body: {},
  });
