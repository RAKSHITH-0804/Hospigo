import { branchSwitchConfig } from '@/config/branch-switch';
import { getClientActiveBranch, refreshSessionOnce } from '@/lib/auth/client-session';
import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import { IMAGE_ROUTES, type BrandingResponse, type ImageMeta } from './types';

/** Browser calls to the Next route handlers of the picture screens. Tokens never reach the browser. */

async function putFileOnce<T>(
  path: string,
  file: File,
  retried: boolean,
): Promise<PatientsApiResult<T>> {
  const form = new FormData();
  form.append('file', file);
  // No Content-Type here: the browser adds the multipart boundary itself.
  const headers: Record<string, string> = { Accept: 'application/json' };
  const branchId = getClientActiveBranch();
  if (branchId) {
    headers[branchSwitchConfig.headerName] = branchId;
  }
  let result: PatientsApiResult<T>;
  try {
    const response = await fetch(path, {
      method: 'PUT',
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
      return { ok: true, data: json as T };
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
  return putFileOnce<T>(path, file, true);
}

/** Sends one picture file. After a quiet session refresh it retries once, like the other screens. */
export const uploadPicture = <T>(path: string, file: File): Promise<PatientsApiResult<T>> =>
  putFileOnce<T>(path, file, false);

export const removePicture = <T>(path: string): Promise<PatientsApiResult<T>> =>
  patientsApi<T>(path, { method: 'POST', body: {} });

export const uploadLogo = (file: File): Promise<PatientsApiResult<ImageMeta>> =>
  uploadPicture<ImageMeta>(IMAGE_ROUTES.logo, file);

export const removeLogo = (): Promise<PatientsApiResult<Pick<BrandingResponse, 'logo'>>> =>
  removePicture(IMAGE_ROUTES.logoRemove);
