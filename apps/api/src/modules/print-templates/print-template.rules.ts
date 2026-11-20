import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';

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

export type PrintLayout = {
  version: 1;
  fontSizePt: number;
  /** Hospital header lines for FULL mode (the hospital name itself comes from the hospital record). */
  headerText: string;
  footerText: string;
  showLogo: boolean;
  /** Which fields appear (every field of the document has an entry). */
  fields: Record<string, boolean>;
  /** Nudges the whole printout (fine tuning of pre-printed stationery). */
  offset: { xMm: number; yMm: number };
  /** PREPRINTED mode: where each field starts, from the top-left corner of the page. */
  positions: Record<string, { xMm: number; yMm: number }>;
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
      REGISTRATION_SLIP: ['uhid', 'patientName', 'age', 'gender', 'registeredOn'],
      RECEIPT: ['billNumber', 'token', 'patientName', 'total'],
      PRESCRIPTION: ['patientName', 'uhid', 'doctorName', 'medicines'],
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

/** The template of a document that its hospital has not changed yet. */
/** Distance between two fields of a starting layout on pre-printed stationery, millimetres. */
const POSITION_ROW_MM = 8;

export const DEFAULT_PRESET_BY_DOC: Record<PrintDocType, string> = {
  REGISTRATION_SLIP: 'A4_FULL',
  RECEIPT: 'A5_FULL',
  PRESCRIPTION: 'A4_FULL',
};

/** Starting point of a document from a preset (a settings screen copies it, then adjusts it). */
export function presetInput(presetKey: string, docType: PrintDocType): PrintTemplateInput {
  const preset = PRESETS[presetKey];
  if (!preset) {
    throw printError('preset', 'UNKNOWN_PRESET');
  }
  const visible = new Set(preset.fieldsOnly?.[docType] ?? PRINT_FIELDS[docType]);
  const fields = Object.fromEntries(PRINT_FIELDS[docType].map((k) => [k, visible.has(k)]));
  // Pre-printed stationery gets a plain starting position for each visible field: top to bottom,
  // then a second column, so every field starts on the page whatever the document.
  const positions: PrintLayout['positions'] = {};
  if (preset.mode === 'PREPRINTED') {
    const pageHeight = preset.heightMm ?? 0;
    const pageWidth = preset.widthMm ?? 0;
    const perColumn = Math.max(1, Math.floor((pageHeight - 25) / POSITION_ROW_MM));
    let index = 0;
    for (const key of PRINT_FIELDS[docType]) {
      if (fields[key]) {
        const column = Math.floor(index / perColumn);
        positions[key] = {
          xMm: round1(Math.min(10 + column * (pageWidth / 2), pageWidth)),
          yMm: round1(15 + (index % perColumn) * POSITION_ROW_MM),
        };
        index += 1;
      }
    }
  }
  return {
    enabled: true,
    preset: presetKey,
    paper: preset.paper,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    orientation: preset.orientation,
    margins: {
      topMm: preset.marginMm,
      rightMm: preset.marginMm,
      bottomMm: preset.marginMm,
      leftMm: preset.marginMm,
    },
    mode: preset.mode,
    layout: {
      version: 1,
      fontSizePt: preset.fontSizePt,
      headerText: '',
      footerText: '',
      showLogo: preset.mode === 'FULL',
      fields,
      offset: { xMm: 0, yMm: 0 },
      positions,
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

  const layout = validateLayout(docType, raw.layout, raw.mode as PrintMode, page);
  return {
    enabled,
    preset,
    ...base,
    margins,
    mode: raw.mode as PrintMode,
    layout,
  };
}

function validateLayout(
  docType: PrintDocType,
  raw: unknown,
  mode: PrintMode,
  page: { widthMm: number; heightMm: number },
): PrintLayout {
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
  const positions: PrintLayout['positions'] = {};
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
