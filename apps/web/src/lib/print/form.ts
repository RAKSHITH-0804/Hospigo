import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import type { PatientsApiError } from '@/lib/patients/client';
import type {
  PrintDocType,
  PrintItem,
  PrintPaper,
  PrintPreset,
  PrintTemplate,
  PrintTemplateInput,
} from './types';

const copy = staffCopy.settings.printing;

/** Size of the standard papers in portrait, millimetres (the API holds the same numbers and checks them). */
export const STANDARD_PAPER_MM: Record<'A4' | 'A5' | 'A6', { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 },
};

/** Papers whose width and height the person types. */
export function paperNeedsSize(paper: PrintPaper): boolean {
  return paper === 'LABEL' || paper === 'CUSTOM';
}

/** The real page size of a form (a landscape A4 is 297 wide), or null while a size is missing. */
export function pageSizeMm(input: PrintTemplateInput): { width: number; height: number } | null {
  if (paperNeedsSize(input.paper)) {
    if (input.widthMm === null || input.heightMm === null) {
      return null;
    }
    return { width: input.widthMm, height: input.heightMm };
  }
  const { width, height } = STANDARD_PAPER_MM[input.paper as 'A4' | 'A5' | 'A6'];
  return input.orientation === 'LANDSCAPE' ? { width: height, height: width } : { width, height };
}

/** What the form edits: the template without the facts the server adds (a deep copy). */
export function toInput(template: PrintTemplate): PrintTemplateInput {
  return {
    enabled: template.enabled,
    preset: template.preset,
    paper: template.paper,
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    orientation: template.orientation,
    margins: { ...template.margins },
    mode: template.mode,
    layout: {
      version: 3,
      fontSizePt: template.layout.fontSizePt,
      offset: { ...template.layout.offset },
      // a deep copy: the boxes hold nested text that an edit must never change in the saved template
      elements: JSON.parse(
        JSON.stringify(template.layout.elements),
      ) as PrintTemplate['layout']['elements'],
    },
  };
}

/** The preset's template for one document, ready to edit. */
export function fromPreset(preset: PrintPreset, docType: PrintDocType): PrintTemplateInput {
  return { ...toInput(preset.templates[docType]), preset: preset.key };
}

/** The body the API takes: a size only for papers that need one. */
export function toPayload(input: PrintTemplateInput): PrintTemplateInput {
  const sized = paperNeedsSize(input.paper);
  return {
    ...input,
    widthMm: sized ? input.widthMm : null,
    heightMm: sized ? input.heightMm : null,
  };
}

function allFinite(input: PrintTemplateInput): boolean {
  const numbers = [
    input.layout.fontSizePt,
    input.layout.offset.xMm,
    input.layout.offset.yMm,
    ...Object.values(input.margins),
    ...input.layout.elements.flatMap((e) => [e.xMm, e.yMm, e.widthMm, e.heightMm]),
  ];
  return numbers.every((n) => Number.isFinite(n));
}

/** The form as a template the page can draw (page size from the paper; null while a value is missing or unreadable). */
export function previewTemplate(
  docType: PrintDocType,
  input: PrintTemplateInput,
): PrintTemplate | null {
  const size = pageSizeMm(input);
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || !allFinite(input)) {
    return null;
  }
  return {
    ...input,
    docType,
    source: 'DEFAULT',
    pageWidthMm: size.width,
    pageHeightMm: size.height,
    updatedAt: null,
  };
}

/** Obviously-sample content for the designer, one entry for every value the document can print. */
export function sampleItems(keys: string[], hospitalName: string): PrintItem[] {
  const s = staffCopy.print.sample;
  const labelOf = (key: string) => staffCopy.print.fields[key] ?? key;
  return keys.map((key): PrintItem => {
    const label = labelOf(key);
    switch (key) {
      case 'hospitalName':
        return { key, label, text: hospitalName };
      case 'patientName':
        return { key, label, text: s.patientName };
      case 'uhid':
        return { key, label, text: s.uhid };
      case 'doctorName':
        return { key, label, text: s.doctorName };
      case 'billNumber':
      case 'receiptNumber':
      case 'token':
        return { key, label, text: s.number };
      case 'visitDate':
      case 'registeredOn':
      case 'followUpDate':
        return { key, label, text: s.date };
      case 'total':
      case 'paid':
      case 'refunded':
        return { key, label, text: s.amount };
      case 'lines':
      case 'paymentModes':
        return { key, label, pairs: [[s.text, s.amount]] };
      case 'vitals':
      case 'medicines':
      case 'tests':
        return { key, label, lines: [s.text, s.text] };
      default:
        return { key, label, text: s.text };
    }
  });
}

function lastSegment(field: string): string {
  const parts = field.split('.');
  return parts[parts.length - 1] ?? field;
}

/** A plain sentence for a refused template: which field and why. Never the server's own text. */
export function invalidMessage(error: Pick<PatientsApiError, 'field' | 'reason'>): string {
  if (!error.field || !error.reason) {
    return copy.invalidFallback;
  }
  const segment = lastSegment(error.field);
  // "layout.elements.3.widthMm": a box, named by its place in the list
  const box = /^layout\.elements\.(\d+)\./.exec(error.field);
  const field = staffCopy.print.fields[segment] ?? copy.fieldNames[segment] ?? segment;
  const reason = copy.reasons[error.reason];
  if (!reason) {
    return copy.invalidFallback;
  }
  const named = box ? fill(copy.boxNamed, { number: Number(box[1]) + 1, field }) : field;
  return fill(copy.invalid, { field: named, reason });
}

/** The values of each document in the order the API lists them (a test keeps the two lists together). */
export const DOC_FIELD_ORDER: Record<PrintDocType, readonly string[]> = {
  REGISTRATION_SLIP: [
    'hospitalName',
    'uhid',
    'patientName',
    'relative',
    'age',
    'gender',
    'phone',
    'address',
    'registeredOn',
    'branchName',
  ],
  RECEIPT: [
    'hospitalName',
    'billNumber',
    'receiptNumber',
    'token',
    'patientName',
    'uhid',
    'doctorName',
    'visitDate',
    'branchName',
    'lines',
    'total',
    'paid',
    'refunded',
    'paymentModes',
    'referenceNo',
  ],
  PRESCRIPTION: [
    'hospitalName',
    'patientName',
    'uhid',
    'age',
    'gender',
    'visitDate',
    'token',
    'doctorName',
    'doctorDepartment',
    'doctorQualifications',
    'doctorSpeciality',
    'doctorRegistrationNo',
    'doctorSignature',
    'vitals',
    'complaints',
    'diagnosis',
    'medicines',
    'tests',
    'advice',
    'followUpDate',
  ],
};
