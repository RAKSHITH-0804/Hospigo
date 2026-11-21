import type {
  PrintAlign,
  PrintContent,
  PrintDocType,
  PrintElement,
  PrintStyle,
  PrintTemplate,
} from './types';

/** A complete template as the API sends it (no boxes yet), for tests. Override what a test cares about. */
export function makeTemplate(
  docType: PrintDocType = 'RECEIPT',
  overrides: Partial<PrintTemplate> = {},
): PrintTemplate {
  return {
    docType,
    source: 'DEFAULT',
    enabled: true,
    preset: 'A5_FULL',
    paper: 'A5',
    widthMm: null,
    heightMm: null,
    orientation: 'PORTRAIT',
    margins: { topMm: 10, rightMm: 10, bottomMm: 10, leftMm: 10 },
    mode: 'FULL',
    layout: { version: 3, fontSizePt: 11, offset: { xMm: 0, yMm: 0 }, elements: [] },
    pageWidthMm: 148,
    pageHeightMm: 210,
    updatedAt: null,
    ...overrides,
  };
}

const CAPTIONS: Record<string, string> = {
  hospitalName: 'Hospital',
  uhid: 'UHID',
  patientName: 'Patient',
  age: 'Age',
  gender: 'Gender',
  phone: 'Phone',
  total: 'Total',
  billNumber: 'Bill no.',
  medicines: 'Medicines',
  lines: 'Items',
  advice: 'Advice',
  complaints: 'Complaints',
  diagnosis: 'Diagnosis',
};

type BoxOptions = Partial<PrintStyle> & {
  /** Words in front of the value (true: the usual caption, false: none). */
  caption?: boolean | string;
  align?: PrintAlign;
  fontSizePt?: number;
  xMm?: number;
  yMm?: number;
  widthMm?: number;
  heightMm?: number;
};

const styleOf = (o: BoxOptions): PrintStyle | undefined => {
  const style: PrintStyle = {};
  const size = o.size ?? o.fontSizePt;
  if (size !== undefined) style.size = size;
  if (o.bold) style.bold = true;
  if (o.italic) style.italic = true;
  if (o.underline) style.underline = true;
  if (o.font) style.font = o.font;
  if (o.tone) style.tone = o.tone;
  return Object.keys(style).length > 0 ? style : undefined;
};

/** A box with a value of the document in it, with its caption in front as plain bold words. */
export function fieldBox(field: string, id: string, options: BoxOptions = {}): PrintElement {
  const style = styleOf(options);
  const captionText =
    options.caption === false
      ? ''
      : typeof options.caption === 'string'
        ? options.caption
        : `${CAPTIONS[field] ?? field}: `;
  const runs: PrintContent['paragraphs'][number]['runs'] = [];
  if (captionText) {
    runs.push({ t: 'text', text: captionText, style: { ...style, bold: true } });
  }
  runs.push(style ? { t: 'field', field, style } : { t: 'field', field });
  return {
    id,
    type: 'RICH',
    xMm: options.xMm ?? 10,
    yMm: options.yMm ?? 10,
    widthMm: options.widthMm ?? 80,
    heightMm: options.heightMm ?? 6,
    content: { paragraphs: [{ ...(options.align ? { align: options.align } : {}), runs }] },
  };
}

/** A box of typed words (a line of text for each \n). */
export function textBox(id: string, text: string, options: BoxOptions = {}): PrintElement {
  const style = styleOf(options);
  return {
    id,
    type: 'RICH',
    xMm: options.xMm ?? 10,
    yMm: options.yMm ?? 5,
    widthMm: options.widthMm ?? 80,
    heightMm: options.heightMm ?? 12,
    content: {
      paragraphs: text.split('\n').map((line) => ({
        ...(options.align ? { align: options.align } : {}),
        runs:
          line === ''
            ? []
            : [
                style
                  ? { t: 'text' as const, text: line, style }
                  : { t: 'text' as const, text: line },
              ],
      })),
    },
  };
}

/** The template with one stacked field box for each key. */
export function withFields(template: PrintTemplate, keys: string[]): PrintTemplate {
  return {
    ...template,
    layout: {
      ...template.layout,
      elements: keys.map((key, index) => fieldBox(key, `b${index + 1}`, { yMm: 10 + index * 8 })),
    },
  };
}

/** The template with exactly these boxes. */
export function withBoxes(template: PrintTemplate, elements: PrintElement[]): PrintTemplate {
  return { ...template, layout: { ...template.layout, elements } };
}
