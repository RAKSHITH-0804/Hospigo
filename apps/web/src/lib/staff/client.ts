import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import {
  STAFF_ROUTES,
  type AccountView,
  type RoleView,
  type StaffBody,
  type StaffCodeFormat,
  type StaffListResponse,
  type StaffMember,
} from './types';

/** Browser calls to the Next route handlers of the staff, roles and account screens. */

export type StaffListQuery = { q?: string; status?: string; page?: number };

export const listStaff = (query: StaffListQuery): Promise<PatientsApiResult<StaffListResponse>> => {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const text = params.toString();
  return patientsApi<StaffListResponse>(
    text ? `${STAFF_ROUTES.people}?${text}` : STAFF_ROUTES.people,
  );
};

export const createStaff = (
  body: StaffBody,
): Promise<PatientsApiResult<{ staff: StaffMember; activationSent: boolean }>> =>
  patientsApi(STAFF_ROUTES.people, { method: 'POST', body });

export const updateStaff = (
  id: string,
  body: Partial<StaffBody>,
): Promise<PatientsApiResult<StaffMember>> =>
  patientsApi<StaffMember>(`${STAFF_ROUTES.people}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });

export type StaffAction = 'deactivate' | 'reactivate' | 'resend-invite' | 'reset-password';

export const staffAction = (
  id: string,
  action: StaffAction,
): Promise<PatientsApiResult<StaffMember | { activationSent: boolean } | { resetSent: boolean }>> =>
  patientsApi(`${STAFF_ROUTES.people}/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: {},
  });

export const saveCodeFormat = (body: {
  prefix: string;
  minWidth: number;
}): Promise<PatientsApiResult<StaffCodeFormat>> =>
  patientsApi<StaffCodeFormat>(STAFF_ROUTES.codeFormat, { method: 'PUT', body });

export type RoleBody = { name: string; description?: string; permissionCodes: string[] };

export const createRole = (body: RoleBody): Promise<PatientsApiResult<RoleView>> =>
  patientsApi<RoleView>(STAFF_ROUTES.roles, { method: 'POST', body });

export const updateRole = (
  id: string,
  body: Partial<RoleBody>,
): Promise<PatientsApiResult<RoleView>> =>
  patientsApi<RoleView>(`${STAFF_ROUTES.roles}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body,
  });

export const roleAction = (
  id: string,
  action: 'deactivate' | 'reactivate',
): Promise<PatientsApiResult<RoleView>> =>
  patientsApi<RoleView>(`${STAFF_ROUTES.roles}/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: {},
  });

export const saveAccount = (body: {
  name?: string;
  phone?: string;
}): Promise<PatientsApiResult<AccountView>> =>
  patientsApi<AccountView>(STAFF_ROUTES.accountMe, { method: 'PUT', body });

export const requestEmailChange = (email: string): Promise<PatientsApiResult<{ sent: true }>> =>
  patientsApi(STAFF_ROUTES.emailRequest, { method: 'POST', body: { email } });

export const confirmEmailChange = (code: string): Promise<PatientsApiResult<AccountView>> =>
  patientsApi<AccountView>(STAFF_ROUTES.emailConfirm, { method: 'POST', body: { code } });

export const requestPasswordChange = (email: string): Promise<PatientsApiResult<{ sent: true }>> =>
  patientsApi(STAFF_ROUTES.passwordRequest, { method: 'POST', body: { email } });

export const confirmPasswordChange = (
  code: string,
  newPassword: string,
): Promise<PatientsApiResult<{ changed: true; signedOutEverywhere: true }>> =>
  patientsApi(STAFF_ROUTES.passwordConfirm, {
    method: 'POST',
    body: { code, newPassword },
  });
