import { NextResponse } from 'next/server';
import { importScreenConfig } from '@/config/imports';
import { assertOrigin } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const refuse = (status: number, reason?: string) =>
  NextResponse.json(reason ? { code: 'IMPORT_FILE_INVALID', reason } : { code: 'UNKNOWN' }, {
    status,
    headers: NO_STORE,
  });

/**
 * The body of the Excel upload route: same-origin check, a multipart form with exactly one file in
 * the field "file", a size check BEFORE the body is read, then the branch-guarded staff call. Only
 * the file is passed on. The API looks at the real bytes and decides everything else.
 */
export async function proxyListUpload(request: Request, path: string): Promise<NextResponse> {
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('multipart/form-data')) {
    return refuse(415);
  }
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) {
    return refuse(400, 'NO_FILE');
  }
  if (length > importScreenConfig.bffMaxBodyBytes) {
    return refuse(400, 'TOO_BIG');
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400);
  }
  const entries = [...form.entries()];
  const file = entries.length === 1 && entries[0]![0] === 'file' ? entries[0]![1] : null;
  if (!(file instanceof File)) {
    return refuse(400, 'NO_FILE');
  }
  const clean = new FormData();
  clean.append('file', file, file.name || 'list.xlsx');
  return staffRoute({ method: 'POST', request, path, form: clean });
}
