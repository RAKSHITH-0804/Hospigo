import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import type { PrintDocType, PrintTemplate, PrintTemplateInput } from './types';

/** Next route handler that proxies the print template API. Browsers never see tokens. */
export const PRINT_TEMPLATES_API = '/api/staff/print-templates';

const docApi = (docType: PrintDocType): string => `${PRINT_TEMPLATES_API}/${docType}`;

export function savePrintTemplate(
  docType: PrintDocType,
  input: PrintTemplateInput,
): Promise<PatientsApiResult<PrintTemplate>> {
  return patientsApi<PrintTemplate>(docApi(docType), { method: 'PUT', body: input });
}

/** Back to the built-in default; the answer is that default template. */
export function resetPrintTemplate(
  docType: PrintDocType,
): Promise<PatientsApiResult<PrintTemplate>> {
  return patientsApi<PrintTemplate>(docApi(docType), { method: 'DELETE' });
}
