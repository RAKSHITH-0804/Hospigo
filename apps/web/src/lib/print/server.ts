import { API_BRANDING, type BrandingResponse } from '@/lib/images/types';
import { fetchStaffOnServer, type ServerFetch } from '@/lib/patients/server';
import {
  API_PRINT_VALUES,
  type EffectivePrintValue,
  type EffectivePrintValuesResponse,
} from '@/lib/print-values/types';
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

/**
 * The extra print values that apply to this branch (Step 8c). A print page must still print when they
 * cannot be read, so every failure means "no extra values" (a template that uses one prints nothing
 * for it).
 */
export async function fetchPrintValues(): Promise<EffectivePrintValue[]> {
  const result = await fetchStaffOnServer<EffectivePrintValuesResponse>(API_PRINT_VALUES);
  return result.status === 'ok' && Array.isArray(result.data.items) ? result.data.items : [];
}

/**
 * The id of the current hospital logo, or null. A print page must still print when the logo cannot
 * be read, so every failure means "no logo" and never an error.
 */
export async function fetchLogoImageId(): Promise<string | null> {
  const result = await fetchStaffOnServer<BrandingResponse>(API_BRANDING);
  return result.status === 'ok' ? (result.data.logo?.id ?? null) : null;
}
