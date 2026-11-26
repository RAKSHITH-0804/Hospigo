/**
 * The print designer's numbers in one place (sizes in millimetres unless the name says otherwise).
 * The API checks the limits again; these only keep the screen from offering what would be refused.
 */
export const printDesignerConfig = {
  /** Boxes on one page (the API refuses more). */
  maxElements: 40,
  /** Text size of a box in points (the API refuses outside this). */
  fontMinPt: 6,
  fontMaxPt: 72,
  fontStepPt: 1,
  /** Arrow keys move the selected box by this much; with Shift by the big step; with Alt by the fine step. */
  nudgeMm: 1,
  nudgeBigMm: 5,
  nudgeFineMm: 0.1,
  /** Grid the boxes snap to while dragging (0 turns it off). */
  snapOptionsMm: [0, 1, 5] as readonly number[],
  snapDefaultMm: 1,
  /** Zoom of the page on the screen, in percent. Boxes keep their millimetres whatever the zoom. */
  zoomOptionsPct: [50, 75, 100, 125, 150, 200, 300] as readonly number[],
  zoomDefaultPct: 100,
  /** "Fit" zooms: the smallest and the largest they may give, the space left around the page,
   *  and the height kept free for the rest of the screen when the whole page is fitted. */
  fitMinPct: 25,
  fitMaxPct: 400,
  fitMarginPx: 24,
  fitPageReservePx: 220,
  /** The ruler's width in CSS pixels (1.25rem). */
  rulerPx: 20,
  /** CSS pixels in one millimetre at 100% (a CSS inch is 96 pixels). */
  pxPerMm: 96 / 25.4,
  /** Steps that can be undone. */
  historyLimit: 100,
  /** The smallest box, and the smallest line (a rule can be very thin). */
  minBoxMm: 1,
  minLineMm: 0.1,
  /** Size of the boxes a click on Add creates. */
  newTextWidthMm: 60,
  newLineWidthMm: 80,
  newLineHeightMm: 0.3,
  newLogoWidthMm: 30,
  newLogoHeightMm: 20,
  newSignatureWidthMm: 40,
  newSignatureHeightMm: 15,
  newFieldWidthMm: 80,
  /** A field box starts about this many text lines tall (a list needs more). */
  newFieldLines: 1,
  newListFieldLines: 4,
  /** Distance of a duplicate from its original. */
  duplicateOffsetMm: 5,
  /** Space between a new box and the lowest box already on the page. */
  newBoxGapMm: 2,
  /** A ruler mark every this many millimetres. */
  rulerTickMm: 10,
  /** Line height as a multiple of the font size, and millimetres per point. */
  lineFactor: 1.5,
  mmPerPt: 0.3528,
  /** Values that are lists (a box for them starts taller). */
  listFields: [
    'address',
    'lines',
    'paymentModes',
    'referenceNo',
    'vitals',
    'receptionSymptoms',
    'complaints',
    'diagnosis',
    'medicines',
    'tests',
    'advice',
    'doctorSignature',
  ] as readonly string[],
} as const;

/** Printing outside the designer. */
export const printConfig = {
  /** The patient card opens the print window this long after the page has shown (the page needs time to paint). */
  autoPrintDelayMs: 600,
} as const;
