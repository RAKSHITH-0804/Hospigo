import { fetchStaffOnServer, type ServerFetch } from '@/lib/patients/server';
import { PRINT_API_PATH, type PrintDocType, type PrintTemplate } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A template as far as the print screens need it. A page never prints from a half-formed answer:
 * anything that is not a complete template is treated as "no template" and the page falls back
 * (the older simple printout, or a calm message).
 */
export function readTemplate(result: ServerFetch<unknown>): PrintTemplate | null {
  if (result.status !== 'ok' || !isObject(result.data)) {
    return null;
  }
  const t = result.data;
  const layout = t.layout;
  const isBox = (e: unknown): boolean =>
    isObject(e) &&
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    [e.xMm, e.yMm, e.widthMm, e.heightMm].every((n) => typeof n === 'number');
  const ok =
    typeof t.docType === 'string' &&
    typeof t.enabled === 'boolean' &&
    (t.mode === 'FULL' || t.mode === 'PREPRINTED') &&
    typeof t.pageWidthMm === 'number' &&
    typeof t.pageHeightMm === 'number' &&
    isObject(t.margins) &&
    isObject(layout) &&
    layout.version === 3 &&
    typeof layout.fontSizePt === 'number' &&
    isObject(layout.offset) &&
    Array.isArray(layout.elements) &&
    layout.elements.every(isBox);
  return ok ? (t as unknown as PrintTemplate) : null;
}

/** The template a document prints with (the hospital's own, or the built-in default). */
export async function fetchTemplate(docType: PrintDocType): Promise<ServerFetch<unknown>> {
  return fetchStaffOnServer<unknown>(`${PRINT_API_PATH}/${docType}`);
}
