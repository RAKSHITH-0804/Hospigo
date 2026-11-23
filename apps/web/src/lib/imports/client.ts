import { branchSwitchConfig } from '@/config/branch-switch';
import { getClientActiveBranch, refreshSessionOnce } from '@/lib/auth/client-session';
import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import {
  IMPORT_ROUTES,
  type ImportAction,
  type ImportBatch,
  type ImportListResponse,
  type ImportRowsResponse,
  type ImportType,
} from './types';

/** Browser calls to the Next route handlers of the Excel upload screen. Tokens never reach the browser. */

export const templateHref = (type: ImportType): string => `${IMPORT_ROUTES.template}/${type}`;

export function listImports(
  page: number,
  pageSize: number,
): Promise<PatientsApiResult<ImportListResponse>> {
  return patientsApi<ImportListResponse>(`${IMPORT_ROUTES.list}?page=${page}&pageSize=${pageSize}`);
}

export function getImport(id: string): Promise<PatientsApiResult<ImportBatch>> {
  return patientsApi<ImportBatch>(`${IMPORT_ROUTES.one}/${encodeURIComponent(id)}`);
}

export function importRows(
  id: string,
  status: 'EXCEPTION' | 'VALID' | 'POSTED',
  page: number,
  pageSize: number,
): Promise<PatientsApiResult<ImportRowsResponse>> {
  return patientsApi<ImportRowsResponse>(
    `${IMPORT_ROUTES.one}/${encodeURIComponent(id)}/rows?status=${status}&page=${page}&pageSize=${pageSize}`,
  );
}

export function importAction(
  id: string,
  action: ImportAction,
): Promise<PatientsApiResult<ImportBatch>> {
  return patientsApi<ImportBatch>(`${IMPORT_ROUTES.one}/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: {},
  });
}

async function postFileOnce(
  path: string,
  file: File,
  retried: boolean,
): Promise<PatientsApiResult<ImportBatch>> {
  const form = new FormData();
  form.append('file', file);
  // No Content-Type here: the browser adds the multipart boundary itself.
  const headers: Record<string, string> = { Accept: 'application/json' };
  const branchId = getClientActiveBranch();
  if (branchId) {
    headers[branchSwitchConfig.headerName] = branchId;
  }
  let result: PatientsApiResult<ImportBatch>;
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: form,
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok) {
      return { ok: true, data: json as ImportBatch };
    }
    const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    result = {
      ok: false,
      status: response.status,
      code: typeof record.code === 'string' ? record.code : 'UNKNOWN',
      reason: typeof record.reason === 'string' ? record.reason : undefined,
      field: typeof record.field === 'string' ? record.field : undefined,
    };
  } catch {
    return { ok: false, status: 0, code: 'UNAVAILABLE' };
  }
  const expired = result.code === 'SESSION_EXPIRED' || result.code === 'UNAUTHORIZED';
  if (retried || result.status !== 401 || !expired) {
    return result;
  }
  if (!(await refreshSessionOnce())) {
    return { ...result, code: 'SESSION_EXPIRED' };
  }
  return postFileOnce(path, file, true);
}

/** Sends one Excel file. After a quiet session refresh it retries once, like the other screens. */
export function uploadImport(
  type: ImportType,
  file: File,
): Promise<PatientsApiResult<ImportBatch>> {
  return postFileOnce(`${IMPORT_ROUTES.one}/${type}/upload`, file, false);
}
