/** What the doctor leave request API answers (Step 8c). The API checks every value and permission. */

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type MyLeaveRequest = {
  id: string;
  fromDate: string;
  toDate: string;
  status: LeaveRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
};

export type MyLeaveRequestsResponse = { items: MyLeaveRequest[]; today: string };

export type AdminLeaveRequest = MyLeaveRequest & {
  doctor: { id: string; code: string; name: string };
  decidedByName: string | null;
};

export type AdminLeaveRequestsResponse = {
  items: AdminLeaveRequest[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
  today: string;
};

export const API_LEAVE_REQUESTS_ADMIN = '/opd/leave-requests';

export const LEAVE_ROUTES = {
  mine: '/api/staff/doctor-profiles/me/leave-requests',
  admin: '/api/staff/opd/leave-requests',
} as const;
