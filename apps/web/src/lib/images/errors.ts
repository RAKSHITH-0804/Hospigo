import { staffCopy } from '@/config/staff-copy';
import type { PatientsApiError } from '@/lib/patients/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type { ImageLimits } from './types';

const copy = staffCopy.pictures;

/** "1 MB", "300 KB": the size limit in words a person understands. */
export function sizeText(bytes: number): string {
  const mb = 1_048_576;
  if (bytes >= mb) {
    const value = bytes / mb;
    return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`;
  }
  return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

/** The sentence under a picture box: what is allowed, from the limits the API sent. */
export function rulesText(limits: ImageLimits): string {
  return copy.rules
    .replace('{size}', sizeText(limits.maxBytes))
    .replace('{min}', String(limits.minSidePx))
    .replace('{max}', String(limits.maxSidePx));
}

/** The calm sentence for a refused picture or removal. The reason names what is wrong with the file. */
export function pictureErrorMessage(error: PatientsApiError, limits: ImageLimits): string {
  if (error.status === 400 && error.code === 'SETTINGS_INVALID' && error.field === 'file') {
    const text = error.reason ? copy.errors[error.reason] : undefined;
    return (text ?? copy.errors.fallback!)
      .replace('{size}', sizeText(limits.maxBytes))
      .replace('{min}', String(limits.minSidePx))
      .replace('{max}', String(limits.maxSidePx));
  }
  return staffErrorMessage(error);
}

/** Checks the chosen file before sending (a quick courtesy: the API checks the real bytes again). */
export function checkChosenFile(file: File, limits: ImageLimits): string | null {
  if (file.size === 0) {
    return copy.errors.EMPTY!;
  }
  if (file.size > limits.maxBytes) {
    return copy.errors.TOO_BIG!.replace('{size}', sizeText(limits.maxBytes));
  }
  if (!limits.types.includes(file.type)) {
    return copy.errors.NOT_AN_IMAGE!;
  }
  return null;
}
