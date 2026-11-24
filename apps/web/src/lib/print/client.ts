import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import type { PrintDocType, PrintScope, PrintTemplate, PrintTemplateInput } from './types';

/** Next route handler that proxies the print template API. Browsers never see tokens. */
export const PRINT_TEMPLATES_API = '/api/staff/print-templates';

const docApi = (docType: PrintDocType, scope?: PrintScope): string =>
  `${PRINT_TEMPLATES_API}/${docType}${scope ? `?scope=${scope}` : ''}`;

export function savePrintTemplate(
  docType: PrintDocType,
  input: PrintTemplateInput,
  scope?: PrintScope,
): Promise<PatientsApiResult<PrintTemplate>> {
  return patientsApi<PrintTemplate>(docApi(docType, scope), { method: 'PUT', body: input });
}

/** Removes the template of one scope; the answer is what applies afterwards (the next level). */
export function resetPrintTemplate(
  docType: PrintDocType,
  scope?: PrintScope,
): Promise<PatientsApiResult<PrintTemplate>> {
  return patientsApi<PrintTemplate>(docApi(docType, scope), { method: 'DELETE' });
}
