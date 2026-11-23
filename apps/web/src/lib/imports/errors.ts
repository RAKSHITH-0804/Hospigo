import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiError } from '@/lib/patients/client';

const copy = staffCopy.imports;

/** The calm sentence for a refused upload step. Never shows upstream text. */
export function importErrorMessage(error: PatientsApiError): string {
  if (error.code === 'IMPORT_FILE_INVALID') {
    return (error.reason ? copy.fileReasons[error.reason] : undefined) ?? copy.fileFallback;
  }
  const byCode = copy.errors[error.code];
  return byCode ?? errorMessageFor(error.code);
}

/** What a failed or stopped batch says about itself (its message is a code, never text). */
export function batchProblemText(message: string | null): string | null {
  if (!message) {
    return null;
  }
  const [head, ...rest] = message.split(':');
  const run = (key: string): string => copy.runReasons[key] ?? copy.runReasons['RUN_FAILED'] ?? '';
  if (head === 'MISSING_COLUMNS') {
    return run('MISSING_COLUMNS').replace('{columns}', rest.join(':').trim());
  }
  if (head === 'STALE') {
    const reason = rest[0] ?? '';
    const row = rest[1];
    const why = copy.rowReasons[reason] ?? run('STALE_GENERIC');
    return `${run('STALE').replace('{row}', row ? copy.staleRow.replace('{row}', row) : '')} ${why}`
      .replace(/\s+/g, ' ')
      .trim();
  }
  return run(head ?? '');
}
