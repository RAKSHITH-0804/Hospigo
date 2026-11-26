/** Print templates as the API sends them (Step 7-3). Sizes are millimetres with at most one decimal. */
export const PRINT_DOC_TYPES = [
  'REGISTRATION_SLIP',
  'RECEIPT',
  'PRESCRIPTION',
  'PATIENT_REPORT',
  'PATIENT_CARD',
] as const;
export type PrintDocType = (typeof PRINT_DOC_TYPES)[number];

export const PRINT_PAPERS = ['A4', 'A5', 'A6', 'LABEL', 'CUSTOM'] as const;
export type PrintPaper = (typeof PRINT_PAPERS)[number];
export type PrintOrientation = 'PORTRAIT' | 'LANDSCAPE';
export type PrintMode = 'FULL' | 'PREPRINTED';

export type PrintMargins = { topMm: number; rightMm: number; bottomMm: number; leftMm: number };
export type PrintPoint = { xMm: number; yMm: number };

export type PrintAlign = 'LEFT' | 'CENTER' | 'RIGHT';
/** A short list of fonts (a dot-matrix printer prints Courier-like text). */
export type PrintFont = 'SANS' | 'SERIF' | 'MONO';
/** Black and grey only: many printers print one colour. */
export type PrintTone = 'BLACK' | 'GREY';

/** The style of a stretch of text (like selecting words in a word processor and changing them). */
export type PrintStyle = {
  /** Text size in points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font?: PrintFont;
  tone?: PrintTone;
};

/** A stretch of words, or a value of the document placed inside the words (like a mail-merge field). */
export type PrintRun =
  | { t: 'text'; text: string; style?: PrintStyle }
  | { t: 'field'; field: string; style?: PrintStyle };

export type PrintParagraph = { align?: PrintAlign; runs: PrintRun[] };
export type PrintContent = { paragraphs: PrintParagraph[] };

/**
 * One box on the page, like a text box in a word processor. RICH holds text typed by a person (each
 * stretch with its own style) with values of the document inside it; LINE is a rule; IMAGE is a
 * picture slot (the hospital logo, or the doctor signature or stamp). Places are millimetres.
 */
/** A picture place on a page: the hospital logo, or the doctor's signature or stamp. */
export type PrintSlot = 'LOGO' | 'SIGNATURE';

/** The pictures a page prints: the id of the picture for each slot (none: the box stays empty). */
export type PrintImages = Partial<Record<PrintSlot, string | null>>;

export type PrintElement = {
  id: string;
  type: 'RICH' | 'LINE' | 'IMAGE';
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  content?: PrintContent;
  slot?: PrintSlot;
  /** LINE colour. */
  tone?: PrintTone;
};

export type PrintLayout = {
  version: 3;
  /** The size of text that has none of its own. */
  fontSizePt: number;
  /** Moves the whole printout (fine tuning of pre-printed stationery). */
  offset: PrintPoint;
  elements: PrintElement[];
};

/** What the form sends (PUT /print-templates/:docType). */
export type PrintTemplateInput = {
  enabled: boolean;
  preset: string | null;
  paper: PrintPaper;
  widthMm: number | null;
  heightMm: number | null;
  orientation: PrintOrientation;
  margins: PrintMargins;
  mode: PrintMode;
  layout: PrintLayout;
};

export type PrintTemplate = PrintTemplateInput & {
  docType: PrintDocType;
  /** CUSTOM: the hospital saved it. DEFAULT: nothing saved, the built-in default applies. */
  source: 'CUSTOM' | 'DEFAULT';
  /** Which one applies to this branch: its own, the hospital's, or the built-in default (Step 8c). */
  scope?: 'BRANCH' | 'HOSPITAL' | 'DEFAULT';
  /** The real page size (a landscape A4 is 297 wide). */
  pageWidthMm: number;
  pageHeightMm: number;
  updatedAt: string | null;
};

/** Where a template is saved: the signed-in branch only, or the whole hospital. */
export type PrintScope = 'branch' | 'hospital';

export type PrintTemplatesResponse = {
  items: PrintTemplate[];
  /** What the caller may change here (Step 8c): this branch's templates, and the hospital's. */
  canChange?: { branch: boolean; hospital: boolean };
};

export type PrintPreset = {
  key: string;
  name: string;
  templates: Record<PrintDocType, PrintTemplate>;
};
export type PrintPresetsResponse = { items: PrintPreset[] };

/** One thing a document can print: a text, a list of lines, or rows of two columns (item and amount). */
export type PrintItem =
  | { key: string; label: string; text: string }
  | { key: string; label: string; lines: string[] }
  | { key: string; label: string; pairs: Array<[string, string]> };

export const PRINT_API_PATH = '/print-templates';
