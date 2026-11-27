/**
 * The layout of a print template as a list of BOXES on the page (version 2), like text boxes in a
 * word processor. Every box has a place and a size in millimetres and one style. This file holds
 * the types and the builder that lays out a starting arrangement (for presets, defaults and for
 * converting an older version 1 template). It has no database and no HTTP in it.
 */
export const ELEMENT_TYPES = ['FIELD', 'TEXT', 'LINE', 'IMAGE'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];
export const ELEMENT_ALIGNS = ['LEFT', 'CENTER', 'RIGHT'] as const;
export type ElementAlign = (typeof ELEMENT_ALIGNS)[number];
/** A short list of fonts (a dot-matrix printer prints Courier-like text). */
export const ELEMENT_FONTS = ['SANS', 'SERIF', 'MONO'] as const;
export type ElementFont = (typeof ELEMENT_FONTS)[number];
/** Black and grey only: many printers print one colour. */
export const ELEMENT_TONES = ['BLACK', 'GREY'] as const;
export type ElementTone = (typeof ELEMENT_TONES)[number];
/** Picture slots: the hospital logo and the doctor's signature or stamp. */
export const IMAGE_SLOTS = ['LOGO', 'SIGNATURE'] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

export type PrintElement = {
  /** Unique inside the template. */
  id: string;
  type: ElementType;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** FIELD: which value of the document the box shows. */
  field?: string;
  /** FIELD: print the caption (for example "Patient") in front of the value. */
  caption?: boolean;
  /** TEXT: fixed text. */
  text?: string;
  /** IMAGE: which picture. */
  slot?: ImageSlot;
  /** One style per box (FIELD and TEXT). */
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: ElementAlign;
  font?: ElementFont;
  tone?: ElementTone;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Millimetres of one point. */
const MM_PER_PT = 0.3528;
/** Line height as a multiple of the font size. */
const LINE_FACTOR = 1.5;

/** How many text lines a box of each value starts with (a list needs more than one). */
const START_LINES: Record<string, number> = {
  address: 2,
  lines: 4,
  paymentModes: 3,
  referenceNo: 2,
  vitals: 3,
  complaints: 3,
  diagnosis: 2,
  medicines: 8,
  tests: 3,
  advice: 3,
  doctorSignature: 3,
};

export function rowHeightMm(fontSizePt: number): number {
  return round1(fontSizePt * MM_PER_PT * LINE_FACTOR);
}

function boxHeightMm(field: string, fontSizePt: number): number {
  return round1(rowHeightMm(fontSizePt) * (START_LINES[field] ?? 1));
}

export type LayoutArgs = {
  /** Every value the document can show, in the document's order. */
  fieldKeys: readonly string[];
  /** The ones to place. */
  visible: ReadonlySet<string>;
  page: { widthMm: number; heightMm: number };
  margins: { topMm: number; rightMm: number; bottomMm: number; leftMm: number };
  mode: 'FULL' | 'PREPRINTED';
  fontSizePt: number;
  headerText: string;
  footerText: string;
  /** Where each value started (a version 1 pre-printed template). */
  positions?: Record<string, { xMm: number; yMm: number }>;
};

const HOSPITAL_FIELD = 'hospitalName';
const START_X_MM = 10;
const START_Y_MM = 15;

/** Keeps a box on the page (never negative, never past the edge) with at least a small size. */
function onPage(
  page: { widthMm: number; heightMm: number },
  box: { xMm: number; yMm: number; widthMm: number; heightMm: number },
) {
  const widthMm = round1(Math.max(1, Math.min(box.widthMm, page.widthMm)));
  const heightMm = round1(Math.max(1, Math.min(box.heightMm, page.heightMm)));
  return {
    xMm: round1(Math.max(0, Math.min(box.xMm, page.widthMm - widthMm))),
    yMm: round1(Math.max(0, Math.min(box.yMm, page.heightMm - heightMm))),
    widthMm,
    heightMm,
  };
}

/**
 * A starting arrangement.
 *  - FULL (plain paper): hospital name and header lines on top, then each value as a "caption and
 *    value" row (one column, or two when they would not fit), the footer at the bottom.
 *  - PREPRINTED: only the values, no captions and no letterhead, from the top-left in two columns
 *    (or at the positions of an older template).
 */
export function buildElements(args: LayoutArgs): PrintElement[] {
  const { page, margins, fontSizePt } = args;
  const keys = args.fieldKeys.filter((k) => args.visible.has(k));
  const out: PrintElement[] = [];
  let counter = 0;
  const id = () => `e${(counter += 1)}`;
  const row = rowHeightMm(fontSizePt);

  if (args.mode === 'PREPRINTED') {
    const pageHeight = page.heightMm;
    const perColumn = Math.max(1, Math.floor((pageHeight - START_Y_MM - 10) / (row + 2)));
    const colWidth = Math.max(20, round1(page.widthMm / 2 - START_X_MM - 2));
    let index = 0;
    for (const key of keys) {
      const height = boxHeightMm(key, fontSizePt);
      const old = args.positions?.[key];
      const column = Math.floor(index / perColumn);
      const base = old ?? {
        xMm: START_X_MM + column * (page.widthMm / 2),
        yMm: START_Y_MM + (index % perColumn) * (row + 2),
      };
      out.push({
        id: id(),
        type: 'FIELD',
        field: key,
        caption: false,
        ...onPage(page, { ...base, widthMm: colWidth, heightMm: height }),
        fontSizePt,
      });
      index += 1;
    }
    return out;
  }

  const left = margins.leftMm;
  const width = Math.max(20, round1(page.widthMm - margins.leftMm - margins.rightMm));
  let y = margins.topMm;
  const footerLines = args.footerText.split(/\r?\n/).filter((l) => l.trim() !== '');
  const footerHeight = footerLines.length > 0 ? round1(row * footerLines.length) : 0;
  const bottom = round1(page.heightMm - margins.bottomMm - footerHeight);

  if (args.visible.has(HOSPITAL_FIELD)) {
    const h = round1(row * 1.6);
    out.push({
      id: id(),
      type: 'FIELD',
      field: HOSPITAL_FIELD,
      caption: false,
      ...onPage(page, { xMm: left, yMm: y, widthMm: width, heightMm: h }),
      fontSizePt: Math.min(72, fontSizePt + 4),
      bold: true,
      align: 'CENTER',
    });
    y = round1(y + h + 1);
  }
  const headerLines = args.headerText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (headerLines.length > 0) {
    const h = round1(row * headerLines.length);
    out.push({
      id: id(),
      type: 'TEXT',
      text: headerLines.join('\n'),
      ...onPage(page, { xMm: left, yMm: y, widthMm: width, heightMm: h }),
      fontSizePt,
      align: 'CENTER',
    });
    y = round1(y + h + 2);
  }

  const rows = keys.filter((k) => k !== HOSPITAL_FIELD);
  const gap = 1;
  const total = rows.reduce((sum, k) => sum + boxHeightMm(k, fontSizePt) + gap, 0);
  const twoColumns = y + total > bottom;
  const colWidth = twoColumns ? round1(width / 2 - 1) : width;
  const top = y;
  let colIndex = 0;
  for (const key of rows) {
    const h = boxHeightMm(key, fontSizePt);
    if (twoColumns && colIndex === 0 && y + h > bottom) {
      colIndex = 1;
      y = top;
    }
    out.push({
      id: id(),
      type: 'FIELD',
      field: key,
      caption: true,
      ...onPage(page, {
        xMm: left + colIndex * (colWidth + 2),
        yMm: y,
        widthMm: colWidth,
        heightMm: h,
      }),
      fontSizePt,
    });
    y = round1(y + h + gap);
  }

  if (footerLines.length > 0) {
    out.push({
      id: id(),
      type: 'TEXT',
      text: footerLines.join('\n'),
      ...onPage(page, {
        xMm: left,
        yMm: page.heightMm - margins.bottomMm - footerHeight,
        widthMm: width,
        heightMm: footerHeight,
      }),
      fontSizePt,
      align: 'CENTER',
      tone: 'GREY',
    });
  }
  return out;
}

// ------------------------------------------------------------------ version 3: rich text boxes

/** The style of a stretch of text (like selecting words in a word processor and changing them). */
export type RichStyle = {
  /** Text size in points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font?: ElementFont;
  tone?: ElementTone;
};

/** A stretch of words, or a value of the document placed inside the text (like a mail-merge field). */
export type RichRun =
  { t: 'text'; text: string; style?: RichStyle } | { t: 'field'; field: string; style?: RichStyle };

export type RichParagraph = { align?: ElementAlign; runs: RichRun[] };
export type RichContent = { paragraphs: RichParagraph[] };

/**
 * A box of the version 3 layout. RICH holds text typed by a person with values of the document
 * inside it; LINE is a rule; IMAGE is a picture slot (the logo).
 */
export type RichElement = {
  id: string;
  type: 'RICH' | 'LINE' | 'IMAGE';
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  content?: RichContent;
  slot?: ImageSlot;
  /** LINE colour. */
  tone?: ElementTone;
};

/** The words in front of each value, as a starting text. A person can change them like any other text. */
export const FIELD_CAPTIONS: Record<string, string> = {
  hospitalName: 'Hospital',
  uhid: 'UHID',
  patientName: 'Patient',
  relative: 'Relative',
  age: 'Age',
  gender: 'Gender',
  phone: 'Phone',
  address: 'Address',
  registeredOn: 'Registered on',
  branchName: 'Branch',
  vitalsLine: 'Vitals',
  linesNumbered: 'Items (numbered)',
  billNumber: 'Bill no.',
  receiptNumber: 'Receipt no.',
  token: 'Token',
  doctorName: 'Doctor',
  visitDate: 'Visit date',
  lines: 'Items',
  total: 'Total',
  paid: 'Paid',
  refunded: 'Refunded',
  paymentModes: 'Payment',
  billedBy: 'Billed by',
  referenceNo: 'Reference',
  doctorDepartment: 'Department',
  doctorQualifications: 'Qualifications',
  doctorSpeciality: 'Speciality',
  doctorRegistrationNo: 'Registration no.',
  doctorSignature: 'Signature',
  vitals: 'Vitals',
  complaints: 'Complaints',
  diagnosis: 'Diagnosis',
  medicines: 'Medicines',
  tests: 'Tests',
  advice: 'Advice',
  followUpDate: 'Follow-up on',
};

function runStyleOf(e: PrintElement): RichStyle | undefined {
  const style: RichStyle = {};
  if (e.fontSizePt !== undefined) style.size = e.fontSizePt;
  if (e.bold) style.bold = true;
  if (e.italic) style.italic = true;
  if (e.underline) style.underline = true;
  if (e.font && e.font !== 'SANS') style.font = e.font;
  if (e.tone && e.tone !== 'BLACK') style.tone = e.tone;
  return Object.keys(style).length > 0 ? style : undefined;
}

const withStyle = <T extends object>(run: T, style: RichStyle | undefined): T =>
  style ? { ...run, style } : run;

/**
 * Version 2 boxes (a field box with a caption, a text box) as version 3 rich text boxes: the
 * caption becomes ordinary bold text in front of a value placed in the text, the style of the box
 * becomes the style of its words, and a text box becomes a paragraph for each line.
 */
export function toRichElements(elements: readonly PrintElement[]): RichElement[] {
  return elements.map((e): RichElement => {
    const base = {
      id: e.id,
      xMm: e.xMm,
      yMm: e.yMm,
      widthMm: e.widthMm,
      heightMm: e.heightMm,
    };
    if (e.type === 'LINE') {
      return { ...base, type: 'LINE', ...(e.tone && e.tone !== 'BLACK' ? { tone: e.tone } : {}) };
    }
    if (e.type === 'IMAGE') {
      return { ...base, type: 'IMAGE', slot: e.slot ?? 'LOGO' };
    }
    const style = runStyleOf(e);
    const align = e.align && e.align !== 'LEFT' ? { align: e.align } : {};
    if (e.type === 'FIELD' && e.field) {
      const runs: RichRun[] = [];
      if (e.caption !== false) {
        runs.push(
          withStyle(
            { t: 'text' as const, text: `${FIELD_CAPTIONS[e.field] ?? e.field}: ` },
            { ...style, bold: true },
          ),
        );
      }
      runs.push(withStyle({ t: 'field' as const, field: e.field }, style));
      return { ...base, type: 'RICH', content: { paragraphs: [{ ...align, runs }] } };
    }
    const lines = (e.text ?? '').split(/\r?\n/);
    return {
      ...base,
      type: 'RICH',
      content: {
        paragraphs: lines.map((line) => ({
          ...align,
          runs: line === '' ? [] : [withStyle({ t: 'text' as const, text: line }, style)],
        })),
      },
    };
  });
}
