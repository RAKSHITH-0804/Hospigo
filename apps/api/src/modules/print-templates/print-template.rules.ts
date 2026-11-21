import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import {
  buildElements,
  toRichElements,
  ELEMENT_ALIGNS,
  ELEMENT_FONTS,
  ELEMENT_TONES,
  ELEMENT_TYPES,
  IMAGE_SLOTS,
  type ElementAlign,
  type ElementFont,
  type ElementTone,
  type PrintElement,
  type RichContent,
  type RichElement,
  type RichParagraph,
  type RichRun,
  type RichStyle,
} from './print-layout';

/**
 * What a print template is, which numbers and fields it may hold, the built-in presets and the
 * default of every document. All limits are here (and checked again by the database). Sizes are
 * millimetres with at most ONE decimal.
 */
export const PRINT_DOC_TYPES = ['REGISTRATION_SLIP', 'RECEIPT', 'PRESCRIPTION'] as const;
export type PrintDocType = (typeof PRINT_DOC_TYPES)[number];
export const PRINT_PAPERS = ['A4', 'A5', 'A6', 'LABEL', 'CUSTOM'] as const;
export type PrintPaper = (typeof PRINT_PAPERS)[number];
export const PRINT_ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;
export type PrintOrientation = (typeof PRINT_ORIENTATIONS)[number];
export const PRINT_MODES = ['FULL', 'PREPRINTED'] as const;
export type PrintMode = (typeof PRINT_MODES)[number];

export const PRINT_LIMITS = {
  sizeMinMm: 20,
  sizeMaxMm: 1000,
  marginMaxMm: 100,
  /** What must stay printable inside the margins, in each direction. */
  printableMinMm: 20,
  offsetMaxMm: 20,
  positionMaxMm: 1000,
  fontMinPt: 6,
  fontMaxPt: 24,
  textMaxLength: 300,
  presetKeyMaxLength: 40,
  /** Boxes on one page, the size of a box, and of a text inside it. */
  elementsMax: 40,
  elementMinMm: 1,
  lineMinMm: 0.1,
  boxFontMaxPt: 72,
  elementIdMaxLength: 40,
  /** The saved layout stays under the database limit (16 000 characters) with room to spare. */
  layoutMaxChars: 15000,
  /** Inside one rich text box. */
  paragraphsMax: 30,
  runsMax: 40,
  runTextMax: 300,
} as const;

/** Size of the standard papers in portrait, millimetres. */
export const PAPER_SIZES_MM: Record<'A4' | 'A5' | 'A6', { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 },
};

/**
 * The fields each document can show. The doctor details after `doctorDepartment` are for the
 * doctor profile step (qualifications, registration number, signature): they are accepted now so
 * that a template needs no change when those details exist, and print only when they are present.
 */
export const PRINT_FIELDS: Record<PrintDocType, readonly string[]> = {
  REGISTRATION_SLIP: [
    'hospitalName',
    'uhid',
    'patientName',
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

/** The older (version 1) layout: fields switched on or off, positions only for pre-printed stationery. */
type LegacyLayout = {
  version: 1;
  fontSizePt: number;
  headerText: string;
  footerText: string;
  showLogo: boolean;
  fields: Record<string, boolean>;
  offset: { xMm: number; yMm: number };
  positions: Record<string, { xMm: number; yMm: number }>;
};

/** The layout of version 2: boxes of a field or a text each with one style (still accepted, converted). */
export type PrintLayoutV2 = {
  version: 2;
  /** The size of text that has none of its own, and the size the starting arrangements use. */
  fontSizePt: number;
  /** Moves the whole printout (fine tuning of pre-printed stationery). */
  offset: { xMm: number; yMm: number };
  elements: PrintElement[];
};

/**
 * The layout (version 3): rich text boxes on the page, like text boxes in a word processor. A box
 * holds words typed by a person, each stretch with its own style, and values of the document placed
 * inside the words (like a mail-merge field).
 */
export type PrintLayout = {
  version: 3;
  /** The size of text that has none of its own. */
  fontSizePt: number;
  /** Moves the whole printout (fine tuning of pre-printed stationery). */
  offset: { xMm: number; yMm: number };
  elements: RichElement[];
};

export type PrintTemplateInput = {
  enabled: boolean;
  preset: string | null;
  paper: PrintPaper;
  widthMm: number | null;
  heightMm: number | null;
  orientation: PrintOrientation;
  margins: { topMm: number; rightMm: number; bottomMm: number; leftMm: number };
  mode: PrintMode;
  layout: PrintLayout;
};

// ------------------------------------------------------------------------------------ presets

type Preset = {
  name: string;
  paper: PrintPaper;
  widthMm: number | null;
  heightMm: number | null;
  orientation: PrintOrientation;
  marginMm: number;
  mode: PrintMode;
  fontSizePt: number;
  /** A label shows only a few fields. */
  fieldsOnly?: Partial<Record<PrintDocType, readonly string[]>>;
};

export const PRESETS: Record<string, Preset> = {
  A4_FULL: {
    name: 'A4, full letterhead',
    paper: 'A4',
    widthMm: null,
    heightMm: null,
    orientation: 'PORTRAIT',
    marginMm: 15,
    mode: 'FULL',
    fontSizePt: 11,
  },
  A5_FULL: {
    name: 'A5, full letterhead',
    paper: 'A5',
    widthMm: null,
    heightMm: null,
    orientation: 'PORTRAIT',
    marginMm: 10,
    mode: 'FULL',
    fontSizePt: 10,
  },
  LABEL_SLIP: {
    name: 'Small label',
    paper: 'LABEL',
    widthMm: 100,
    heightMm: 50,
    orientation: 'LANDSCAPE',
    marginMm: 3,
    mode: 'FULL',
    fontSizePt: 8,
    fieldsOnly: {
      REGISTRATION_SLIP: ['hospitalName', 'uhid', 'patientName', 'age', 'gender', 'registeredOn'],
      RECEIPT: ['hospitalName', 'billNumber', 'token', 'patientName', 'total'],
      PRESCRIPTION: ['hospitalName', 'patientName', 'uhid', 'doctorName', 'medicines'],
    },
  },
  PREPRINTED_BILL: {
    name: 'Pre-printed stationery (only the data is printed)',
    paper: 'CUSTOM',
    widthMm: 240,
    heightMm: 140,
    orientation: 'LANDSCAPE',
    marginMm: 0,
    mode: 'PREPRINTED',
    fontSizePt: 10,
  },
};

export const DEFAULT_PRESET_BY_DOC: Record<PrintDocType, string> = {
  REGISTRATION_SLIP: 'A4_FULL',
  RECEIPT: 'A5_FULL',
  PRESCRIPTION: 'A4_FULL',
};

/** Starting point of a document from a preset (a settings screen copies it, then adjusts it). */
export function presetInputV2(
  presetKey: string,
  docType: PrintDocType,
): Omit<PrintTemplateInput, 'layout'> & { layout: PrintLayoutV2 } {
  const preset = PRESETS[presetKey];
  if (!preset) {
    throw printError('preset', 'UNKNOWN_PRESET');
  }
  const wanted = new Set(preset.fieldsOnly?.[docType] ?? PRINT_FIELDS[docType]);
  // Pre-printed stationery already carries the hospital name.
  if (preset.mode === 'PREPRINTED') {
    wanted.delete('hospitalName');
  }
  const margins = {
    topMm: preset.marginMm,
    rightMm: preset.marginMm,
    bottomMm: preset.marginMm,
    leftMm: preset.marginMm,
  };
  const page = pageSizeMm(preset);
  return {
    enabled: true,
    preset: presetKey,
    paper: preset.paper,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    orientation: preset.orientation,
    margins,
    mode: preset.mode,
    layout: {
      version: 2,
      fontSizePt: preset.fontSizePt,
      offset: { xMm: 0, yMm: 0 },
      elements: buildElements({
        fieldKeys: PRINT_FIELDS[docType],
        visible: wanted,
        page,
        margins,
        mode: preset.mode,
        fontSizePt: preset.fontSizePt,
        headerText: '',
        footerText: '',
      }),
    },
  };
}

/** Starting point of a document from a preset: rich text boxes (version 3). */
export function presetInput(presetKey: string, docType: PrintDocType): PrintTemplateInput {
  const v2 = presetInputV2(presetKey, docType);
  return {
    ...v2,
    layout: {
      version: 3,
      fontSizePt: v2.layout.fontSizePt,
      offset: v2.layout.offset,
      elements: toRichElements(v2.layout.elements),
    },
  };
}

export function defaultInput(docType: PrintDocType): PrintTemplateInput {
  return presetInput(DEFAULT_PRESET_BY_DOC[docType], docType);
}

/** The real size of the page in millimetres (landscape turns a standard paper on its side). */
export function pageSizeMm(
  t: Pick<PrintTemplateInput, 'paper' | 'widthMm' | 'heightMm' | 'orientation'>,
): {
  widthMm: number;
  heightMm: number;
} {
  if (t.paper === 'LABEL' || t.paper === 'CUSTOM') {
    return { widthMm: t.widthMm ?? 0, heightMm: t.heightMm ?? 0 };
  }
  const size = PAPER_SIZES_MM[t.paper];
  return t.orientation === 'LANDSCAPE'
    ? { widthMm: size.height, heightMm: size.width }
    : { widthMm: size.width, heightMm: size.height };
}

// ------------------------------------------------------------------------------- validation

export function printError(field: string, reason: string) {
  return opdError(400, OpdErrorCode.PRINT_TEMPLATE_INVALID, { field, reason });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A finite number with at most one decimal, inside a range. */
function num(field: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw printError(field, 'NOT_A_NUMBER');
  }
  if (round1(value) !== value) {
    throw printError(field, 'TOO_MANY_DECIMALS');
  }
  if (value < min || value > max) {
    throw printError(field, 'OUT_OF_RANGE');
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An object with exactly the allowed keys (a stray key is an error, never ignored). */
function onlyKeys(field: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw printError(`${field}.${key}`, 'UNKNOWN_FIELD');
    }
  }
}

function text(field: string, value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw printError(field, 'NOT_TEXT');
  }
  const trimmed = value.trim();
  if (trimmed.length > PRINT_LIMITS.textMaxLength) {
    throw printError(field, 'TOO_LONG');
  }
  return trimmed;
}

/**
 * Checks a template the caller sent and returns it clean (trimmed text, every field of the
 * document present). Everything is refused with `400 PRINT_TEMPLATE_INVALID { field, reason }`:
 * unknown keys, numbers out of range, a paper without its size, margins that leave no room to print,
 * fields that do not belong to the document, positions off the page.
 */
export function validateTemplate(docType: PrintDocType, raw: unknown): PrintTemplateInput {
  if (!isObject(raw)) {
    throw printError('template', 'NOT_AN_OBJECT');
  }
  onlyKeys('template', raw, [
    'enabled',
    'preset',
    'paper',
    'widthMm',
    'heightMm',
    'orientation',
    'margins',
    'mode',
    'layout',
  ]);

  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== 'boolean') {
    throw printError('enabled', 'NOT_A_BOOLEAN');
  }

  let preset: string | null = null;
  if (raw.preset !== undefined && raw.preset !== null) {
    if (typeof raw.preset !== 'string' || !PRESETS[raw.preset]) {
      throw printError('preset', 'UNKNOWN_PRESET');
    }
    preset = raw.preset;
  }

  if (typeof raw.paper !== 'string' || !(PRINT_PAPERS as readonly string[]).includes(raw.paper)) {
    throw printError('paper', 'UNKNOWN_PAPER');
  }
  const paper = raw.paper as PrintPaper;
  const sized = paper === 'LABEL' || paper === 'CUSTOM';
  let widthMm: number | null = null;
  let heightMm: number | null = null;
  if (sized) {
    if (raw.widthMm === undefined || raw.widthMm === null) {
      throw printError('widthMm', 'REQUIRED_FOR_THIS_PAPER');
    }
    if (raw.heightMm === undefined || raw.heightMm === null) {
      throw printError('heightMm', 'REQUIRED_FOR_THIS_PAPER');
    }
    widthMm = num('widthMm', raw.widthMm, PRINT_LIMITS.sizeMinMm, PRINT_LIMITS.sizeMaxMm);
    heightMm = num('heightMm', raw.heightMm, PRINT_LIMITS.sizeMinMm, PRINT_LIMITS.sizeMaxMm);
  } else if (
    (raw.widthMm !== undefined && raw.widthMm !== null) ||
    (raw.heightMm !== undefined && raw.heightMm !== null)
  ) {
    throw printError('widthMm', 'NOT_ALLOWED_FOR_THIS_PAPER');
  }

  if (
    typeof raw.orientation !== 'string' ||
    !(PRINT_ORIENTATIONS as readonly string[]).includes(raw.orientation)
  ) {
    throw printError('orientation', 'UNKNOWN_ORIENTATION');
  }
  if (typeof raw.mode !== 'string' || !(PRINT_MODES as readonly string[]).includes(raw.mode)) {
    throw printError('mode', 'UNKNOWN_MODE');
  }

  if (!isObject(raw.margins)) {
    throw printError('margins', 'NOT_AN_OBJECT');
  }
  onlyKeys('margins', raw.margins, ['topMm', 'rightMm', 'bottomMm', 'leftMm']);
  const margins = {
    topMm: num('margins.topMm', raw.margins.topMm, 0, PRINT_LIMITS.marginMaxMm),
    rightMm: num('margins.rightMm', raw.margins.rightMm, 0, PRINT_LIMITS.marginMaxMm),
    bottomMm: num('margins.bottomMm', raw.margins.bottomMm, 0, PRINT_LIMITS.marginMaxMm),
    leftMm: num('margins.leftMm', raw.margins.leftMm, 0, PRINT_LIMITS.marginMaxMm),
  };

  const base = {
    paper,
    widthMm,
    heightMm,
    orientation: raw.orientation as PrintOrientation,
  };
  const page = pageSizeMm(base);
  if (page.widthMm - margins.leftMm - margins.rightMm < PRINT_LIMITS.printableMinMm) {
    throw printError('margins', 'NO_ROOM_TO_PRINT_ACROSS');
  }
  if (page.heightMm - margins.topMm - margins.bottomMm < PRINT_LIMITS.printableMinMm) {
    throw printError('margins', 'NO_ROOM_TO_PRINT_DOWN');
  }

  const layout = validateLayout(docType, raw.layout, raw.mode as PrintMode, page, margins);
  return {
    enabled,
    preset,
    ...base,
    margins,
    mode: raw.mode as PrintMode,
    layout,
  };
}

function validateLegacyLayout(
  docType: PrintDocType,
  raw: unknown,
  mode: PrintMode,
  page: { widthMm: number; heightMm: number },
): LegacyLayout {
  if (!isObject(raw)) {
    throw printError('layout', 'NOT_AN_OBJECT');
  }
  onlyKeys('layout', raw, [
    'version',
    'fontSizePt',
    'headerText',
    'footerText',
    'showLogo',
    'fields',
    'offset',
    'positions',
  ]);
  if (raw.version !== undefined && raw.version !== 1) {
    throw printError('layout.version', 'UNKNOWN_VERSION');
  }
  const fontSizePt = num(
    'layout.fontSizePt',
    raw.fontSizePt,
    PRINT_LIMITS.fontMinPt,
    PRINT_LIMITS.fontMaxPt,
  );
  const showLogo = raw.showLogo === undefined ? true : raw.showLogo;
  if (typeof showLogo !== 'boolean') {
    throw printError('layout.showLogo', 'NOT_A_BOOLEAN');
  }

  const allowed = PRINT_FIELDS[docType];
  const fieldsIn = raw.fields === undefined ? {} : raw.fields;
  if (!isObject(fieldsIn)) {
    throw printError('layout.fields', 'NOT_AN_OBJECT');
  }
  onlyKeys('layout.fields', fieldsIn, allowed);
  const fields: Record<string, boolean> = {};
  for (const key of allowed) {
    const value = fieldsIn[key];
    if (value !== undefined && typeof value !== 'boolean') {
      throw printError(`layout.fields.${key}`, 'NOT_A_BOOLEAN');
    }
    // A field left out is shown (the safe default for a document).
    fields[key] = value === undefined ? true : value;
  }

  let offset = { xMm: 0, yMm: 0 };
  if (raw.offset !== undefined) {
    if (!isObject(raw.offset)) {
      throw printError('layout.offset', 'NOT_AN_OBJECT');
    }
    onlyKeys('layout.offset', raw.offset, ['xMm', 'yMm']);
    offset = {
      xMm: num(
        'layout.offset.xMm',
        raw.offset.xMm ?? 0,
        -PRINT_LIMITS.offsetMaxMm,
        PRINT_LIMITS.offsetMaxMm,
      ),
      yMm: num(
        'layout.offset.yMm',
        raw.offset.yMm ?? 0,
        -PRINT_LIMITS.offsetMaxMm,
        PRINT_LIMITS.offsetMaxMm,
      ),
    };
  }

  const positionsIn = raw.positions === undefined ? {} : raw.positions;
  if (!isObject(positionsIn)) {
    throw printError('layout.positions', 'NOT_AN_OBJECT');
  }
  onlyKeys('layout.positions', positionsIn, allowed);
  const positions: LegacyLayout['positions'] = {};
  for (const [key, value] of Object.entries(positionsIn)) {
    if (!isObject(value)) {
      throw printError(`layout.positions.${key}`, 'NOT_AN_OBJECT');
    }
    onlyKeys(`layout.positions.${key}`, value, ['xMm', 'yMm']);
    positions[key] = {
      xMm: num(
        `layout.positions.${key}.xMm`,
        value.xMm,
        0,
        Math.min(page.widthMm, PRINT_LIMITS.positionMaxMm),
      ),
      yMm: num(
        `layout.positions.${key}.yMm`,
        value.yMm,
        0,
        Math.min(page.heightMm, PRINT_LIMITS.positionMaxMm),
      ),
    };
  }
  // Positions mean something only on pre-printed stationery; a FULL template with positions would
  // silently ignore them, so it is refused instead.
  if (mode === 'FULL' && Object.keys(positions).length > 0) {
    throw printError('layout.positions', 'ONLY_FOR_PREPRINTED');
  }

  return {
    version: 1,
    fontSizePt,
    headerText: text('layout.headerText', raw.headerText),
    footerText: text('layout.footerText', raw.footerText),
    showLogo,
    fields,
    offset,
    positions,
  };
}

// ------------------------------------------------------------------- layout (version 2)

function parseOffset(raw: unknown): { xMm: number; yMm: number } {
  if (raw === undefined) {
    return { xMm: 0, yMm: 0 };
  }
  if (!isObject(raw)) {
    throw printError('layout.offset', 'NOT_AN_OBJECT');
  }
  onlyKeys('layout.offset', raw, ['xMm', 'yMm']);
  return {
    xMm: num(
      'layout.offset.xMm',
      raw.xMm ?? 0,
      -PRINT_LIMITS.offsetMaxMm,
      PRINT_LIMITS.offsetMaxMm,
    ),
    yMm: num(
      'layout.offset.yMm',
      raw.yMm ?? 0,
      -PRINT_LIMITS.offsetMaxMm,
      PRINT_LIMITS.offsetMaxMm,
    ),
  };
}

const ELEMENT_COMMON = ['id', 'type', 'xMm', 'yMm', 'widthMm', 'heightMm'] as const;
const ELEMENT_STYLE = [
  'fontSizePt',
  'bold',
  'italic',
  'underline',
  'align',
  'font',
  'tone',
] as const;
const ELEMENT_KEYS: Record<PrintElement['type'], readonly string[]> = {
  FIELD: [...ELEMENT_COMMON, 'field', 'caption', ...ELEMENT_STYLE],
  TEXT: [...ELEMENT_COMMON, 'text', ...ELEMENT_STYLE],
  LINE: [...ELEMENT_COMMON, 'tone'],
  IMAGE: [...ELEMENT_COMMON, 'slot'],
};
const ELEMENT_ID = /^[A-Za-z0-9_-]+$/;

function oneOf<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
  reason: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw printError(field, reason);
  }
  return value as T;
}

function flag(field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw printError(field, 'NOT_A_BOOLEAN');
  }
  return value;
}

function validateElement(
  docType: PrintDocType,
  raw: unknown,
  index: number,
  page: { widthMm: number; heightMm: number },
  seen: Set<string>,
): PrintElement {
  const f = `layout.elements.${index}`;
  if (!isObject(raw)) {
    throw printError(f, 'NOT_AN_OBJECT');
  }
  const type = oneOf(`${f}.type`, raw.type, ELEMENT_TYPES, 'UNKNOWN_TYPE');
  onlyKeys(f, raw, ELEMENT_KEYS[type]);

  if (
    typeof raw.id !== 'string' ||
    raw.id.length < 1 ||
    raw.id.length > PRINT_LIMITS.elementIdMaxLength ||
    !ELEMENT_ID.test(raw.id)
  ) {
    throw printError(`${f}.id`, 'BAD_ID');
  }
  if (seen.has(raw.id)) {
    throw printError(`${f}.id`, 'DUPLICATE_ID');
  }
  seen.add(raw.id);

  const min = type === 'LINE' ? PRINT_LIMITS.lineMinMm : PRINT_LIMITS.elementMinMm;
  const xMm = num(`${f}.xMm`, raw.xMm, 0, page.widthMm);
  const yMm = num(`${f}.yMm`, raw.yMm, 0, page.heightMm);
  const widthMm = num(`${f}.widthMm`, raw.widthMm, min, page.widthMm);
  const heightMm = num(`${f}.heightMm`, raw.heightMm, min, page.heightMm);
  // A box stays on the page: a part outside it would be cut off by the printer.
  if (round1(xMm + widthMm) > page.widthMm) {
    throw printError(`${f}.widthMm`, 'OUT_OF_PAGE');
  }
  if (round1(yMm + heightMm) > page.heightMm) {
    throw printError(`${f}.heightMm`, 'OUT_OF_PAGE');
  }
  const out: PrintElement = { id: raw.id, type, xMm, yMm, widthMm, heightMm };

  if (type === 'FIELD') {
    if (typeof raw.field !== 'string' || !PRINT_FIELDS[docType].includes(raw.field)) {
      throw printError(`${f}.field`, 'UNKNOWN_FIELD');
    }
    out.field = raw.field;
    out.caption = raw.caption === undefined ? true : flag(`${f}.caption`, raw.caption);
  }
  if (type === 'TEXT') {
    if (raw.text === undefined || (typeof raw.text === 'string' && raw.text.trim() === '')) {
      throw printError(`${f}.text`, 'REQUIRED');
    }
    out.text = text(`${f}.text`, raw.text);
  }
  if (type === 'IMAGE') {
    out.slot =
      raw.slot === undefined ? 'LOGO' : oneOf(`${f}.slot`, raw.slot, IMAGE_SLOTS, 'UNKNOWN_SLOT');
  }
  if (type === 'FIELD' || type === 'TEXT') {
    if (raw.fontSizePt !== undefined) {
      out.fontSizePt = num(
        `${f}.fontSizePt`,
        raw.fontSizePt,
        PRINT_LIMITS.fontMinPt,
        PRINT_LIMITS.boxFontMaxPt,
      );
    }
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (raw[key] !== undefined) {
        out[key] = flag(`${f}.${key}`, raw[key]);
      }
    }
    if (raw.align !== undefined) {
      out.align = oneOf<ElementAlign>(`${f}.align`, raw.align, ELEMENT_ALIGNS, 'UNKNOWN_ALIGN');
    }
    if (raw.font !== undefined) {
      out.font = oneOf<ElementFont>(`${f}.font`, raw.font, ELEMENT_FONTS, 'UNKNOWN_FONT');
    }
  }
  if (type !== 'IMAGE' && raw.tone !== undefined) {
    out.tone = oneOf<ElementTone>(`${f}.tone`, raw.tone, ELEMENT_TONES, 'UNKNOWN_TONE');
  }
  return out;
}

/**
 * The layout. Version 2 (boxes) is checked box by box. A version 1 layout (an older template or an
 * older caller) is converted: the same fields in the same places, as boxes. Either way the result
 * is version 2.
 */
function validateLayoutV2(
  docType: PrintDocType,
  raw: unknown,
  mode: PrintMode,
  page: { widthMm: number; heightMm: number },
  margins: PrintTemplateInput['margins'],
): PrintLayoutV2 {
  if (!isObject(raw)) {
    throw printError('layout', 'NOT_AN_OBJECT');
  }
  const legacy = raw.version === 1 || (raw.version === undefined && !('elements' in raw));
  if (legacy) {
    const old = validateLegacyLayout(docType, raw, mode, page);
    const visible = new Set(
      Object.entries(old.fields)
        .filter(([, on]) => on)
        .map(([key]) => key),
    );
    if (mode === 'PREPRINTED') {
      visible.delete('hospitalName');
    }
    return {
      version: 2,
      fontSizePt: old.fontSizePt,
      offset: old.offset,
      elements: buildElements({
        fieldKeys: PRINT_FIELDS[docType],
        visible,
        page,
        margins,
        mode,
        fontSizePt: old.fontSizePt,
        headerText: old.headerText,
        footerText: old.footerText,
        positions: old.positions,
      }),
    };
  }

  onlyKeys('layout', raw, ['version', 'fontSizePt', 'offset', 'elements']);
  if (raw.version !== 2) {
    throw printError('layout.version', 'UNKNOWN_VERSION');
  }
  const fontSizePt = num(
    'layout.fontSizePt',
    raw.fontSizePt,
    PRINT_LIMITS.fontMinPt,
    PRINT_LIMITS.fontMaxPt,
  );
  if (!Array.isArray(raw.elements)) {
    throw printError('layout.elements', 'NOT_A_LIST');
  }
  if (raw.elements.length > PRINT_LIMITS.elementsMax) {
    throw printError('layout.elements', 'TOO_MANY');
  }
  const seen = new Set<string>();
  const elements = raw.elements.map((e, index) => validateElement(docType, e, index, page, seen));
  return {
    version: 2,
    fontSizePt,
    offset: parseOffset(raw.offset),
    elements,
  };
}

// ------------------------------------------------------------------- layout (version 3)

const RICH_KEYS: Record<RichElement['type'], readonly string[]> = {
  RICH: [...ELEMENT_COMMON, 'content'],
  LINE: [...ELEMENT_COMMON, 'tone'],
  IMAGE: [...ELEMENT_COMMON, 'slot'],
};
const RICH_TYPES = ['RICH', 'LINE', 'IMAGE'] as const;
const STYLE_KEYS = ['size', 'bold', 'italic', 'underline', 'font', 'tone'] as const;

function validateStyle(field: string, raw: unknown): RichStyle | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isObject(raw)) {
    throw printError(field, 'NOT_AN_OBJECT');
  }
  onlyKeys(field, raw, STYLE_KEYS);
  const style: RichStyle = {};
  if (raw.size !== undefined) {
    style.size = num(`${field}.size`, raw.size, PRINT_LIMITS.fontMinPt, PRINT_LIMITS.boxFontMaxPt);
  }
  for (const key of ['bold', 'italic', 'underline'] as const) {
    if (raw[key] !== undefined) {
      style[key] = flag(`${field}.${key}`, raw[key]);
    }
  }
  if (raw.font !== undefined) {
    style.font = oneOf<ElementFont>(`${field}.font`, raw.font, ELEMENT_FONTS, 'UNKNOWN_FONT');
  }
  if (raw.tone !== undefined) {
    style.tone = oneOf<ElementTone>(`${field}.tone`, raw.tone, ELEMENT_TONES, 'UNKNOWN_TONE');
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function validateRun(docType: PrintDocType, raw: unknown, f: string): RichRun {
  if (!isObject(raw)) {
    throw printError(f, 'NOT_AN_OBJECT');
  }
  if (raw.t === 'text') {
    onlyKeys(f, raw, ['t', 'text', 'style']);
    if (typeof raw.text !== 'string') {
      throw printError(`${f}.text`, 'NOT_TEXT');
    }
    if (raw.text.length === 0) {
      throw printError(`${f}.text`, 'REQUIRED');
    }
    if (raw.text.length > PRINT_LIMITS.runTextMax) {
      throw printError(`${f}.text`, 'TOO_LONG');
    }
    // A line break is a new paragraph, never a character inside a stretch of words.
    if (/[\r\n]/.test(raw.text)) {
      throw printError(`${f}.text`, 'NOT_TEXT');
    }
    const style = validateStyle(`${f}.style`, raw.style);
    return style ? { t: 'text', text: raw.text, style } : { t: 'text', text: raw.text };
  }
  if (raw.t === 'field') {
    onlyKeys(f, raw, ['t', 'field', 'style']);
    if (typeof raw.field !== 'string' || !PRINT_FIELDS[docType].includes(raw.field)) {
      throw printError(`${f}.field`, 'UNKNOWN_FIELD');
    }
    const style = validateStyle(`${f}.style`, raw.style);
    return style ? { t: 'field', field: raw.field, style } : { t: 'field', field: raw.field };
  }
  throw printError(`${f}.t`, 'UNKNOWN_TYPE');
}

function validateContent(docType: PrintDocType, raw: unknown, f: string): RichContent {
  if (!isObject(raw)) {
    throw printError(f, 'NOT_AN_OBJECT');
  }
  onlyKeys(f, raw, ['paragraphs']);
  if (!Array.isArray(raw.paragraphs)) {
    throw printError(`${f}.paragraphs`, 'NOT_A_LIST');
  }
  if (raw.paragraphs.length < 1) {
    throw printError(`${f}.paragraphs`, 'REQUIRED');
  }
  if (raw.paragraphs.length > PRINT_LIMITS.paragraphsMax) {
    throw printError(`${f}.paragraphs`, 'TOO_MANY');
  }
  const paragraphs = raw.paragraphs.map((p, pi): RichParagraph => {
    const pf = `${f}.paragraphs.${pi}`;
    if (!isObject(p)) {
      throw printError(pf, 'NOT_AN_OBJECT');
    }
    onlyKeys(pf, p, ['align', 'runs']);
    if (!Array.isArray(p.runs)) {
      throw printError(`${pf}.runs`, 'NOT_A_LIST');
    }
    if (p.runs.length > PRINT_LIMITS.runsMax) {
      throw printError(`${pf}.runs`, 'TOO_MANY');
    }
    const runs = p.runs.map((r, ri) => validateRun(docType, r, `${pf}.runs.${ri}`));
    if (p.align === undefined) {
      return { runs };
    }
    return {
      align: oneOf<ElementAlign>(`${pf}.align`, p.align, ELEMENT_ALIGNS, 'UNKNOWN_ALIGN'),
      runs,
    };
  });
  return { paragraphs };
}

function validateRichElement(
  docType: PrintDocType,
  raw: unknown,
  index: number,
  page: { widthMm: number; heightMm: number },
  seen: Set<string>,
): RichElement {
  const f = `layout.elements.${index}`;
  if (!isObject(raw)) {
    throw printError(f, 'NOT_AN_OBJECT');
  }
  const type = oneOf(`${f}.type`, raw.type, RICH_TYPES, 'UNKNOWN_TYPE');
  onlyKeys(f, raw, RICH_KEYS[type]);
  if (
    typeof raw.id !== 'string' ||
    raw.id.length < 1 ||
    raw.id.length > PRINT_LIMITS.elementIdMaxLength ||
    !ELEMENT_ID.test(raw.id)
  ) {
    throw printError(`${f}.id`, 'BAD_ID');
  }
  if (seen.has(raw.id)) {
    throw printError(`${f}.id`, 'DUPLICATE_ID');
  }
  seen.add(raw.id);
  const min = type === 'LINE' ? PRINT_LIMITS.lineMinMm : PRINT_LIMITS.elementMinMm;
  const xMm = num(`${f}.xMm`, raw.xMm, 0, page.widthMm);
  const yMm = num(`${f}.yMm`, raw.yMm, 0, page.heightMm);
  const widthMm = num(`${f}.widthMm`, raw.widthMm, min, page.widthMm);
  const heightMm = num(`${f}.heightMm`, raw.heightMm, min, page.heightMm);
  if (round1(xMm + widthMm) > page.widthMm) {
    throw printError(`${f}.widthMm`, 'OUT_OF_PAGE');
  }
  if (round1(yMm + heightMm) > page.heightMm) {
    throw printError(`${f}.heightMm`, 'OUT_OF_PAGE');
  }
  const out: RichElement = { id: raw.id, type, xMm, yMm, widthMm, heightMm };
  if (type === 'RICH') {
    if (raw.content === undefined) {
      throw printError(`${f}.content`, 'REQUIRED');
    }
    out.content = validateContent(docType, raw.content, `${f}.content`);
  }
  if (type === 'IMAGE') {
    out.slot =
      raw.slot === undefined ? 'LOGO' : oneOf(`${f}.slot`, raw.slot, IMAGE_SLOTS, 'UNKNOWN_SLOT');
  }
  if (type === 'LINE' && raw.tone !== undefined) {
    out.tone = oneOf<ElementTone>(`${f}.tone`, raw.tone, ELEMENT_TONES, 'UNKNOWN_TONE');
  }
  return out;
}

/**
 * The layout. Version 3 (rich text boxes) is checked box by box, run by run. Version 2 and
 * version 1 layouts (older templates or older callers) are checked by their own rules and then
 * CONVERTED: the same words, values and places, as rich text boxes. The result is always version 3.
 */
function validateLayout(
  docType: PrintDocType,
  raw: unknown,
  mode: PrintMode,
  page: { widthMm: number; heightMm: number },
  margins: PrintTemplateInput['margins'],
): PrintLayout {
  if (!isObject(raw)) {
    throw printError('layout', 'NOT_AN_OBJECT');
  }
  if (raw.version !== 3) {
    const old = validateLayoutV2(docType, raw, mode, page, margins);
    return finishLayout({
      version: 3,
      fontSizePt: old.fontSizePt,
      offset: old.offset,
      elements: toRichElements(old.elements),
    });
  }
  onlyKeys('layout', raw, ['version', 'fontSizePt', 'offset', 'elements']);
  const fontSizePt = num(
    'layout.fontSizePt',
    raw.fontSizePt,
    PRINT_LIMITS.fontMinPt,
    PRINT_LIMITS.fontMaxPt,
  );
  if (!Array.isArray(raw.elements)) {
    throw printError('layout.elements', 'NOT_A_LIST');
  }
  if (raw.elements.length > PRINT_LIMITS.elementsMax) {
    throw printError('layout.elements', 'TOO_MANY');
  }
  const seen = new Set<string>();
  const elements = raw.elements.map((e, index) =>
    validateRichElement(docType, e, index, page, seen),
  );
  return finishLayout({ version: 3, fontSizePt, offset: parseOffset(raw.offset), elements });
}

/** The saved layout stays under the database limit with room to spare. */
function finishLayout(layout: PrintLayout): PrintLayout {
  if (JSON.stringify(layout).length > PRINT_LIMITS.layoutMaxChars) {
    throw printError('layout', 'TOO_LARGE');
  }
  return layout;
}
