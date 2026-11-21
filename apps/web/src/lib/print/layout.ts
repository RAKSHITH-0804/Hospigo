import type { CSSProperties } from 'react';
import type {
  PrintAlign,
  PrintElement,
  PrintFont,
  PrintItem,
  PrintStyle,
  PrintTemplate,
  PrintTone,
} from './types';

/** One decimal at most, so a sum of millimetres never prints as 10.100000000000001mm. */
export function mm(value: number): string {
  return `${Math.round(value * 10) / 10}mm`;
}

/**
 * The @page rule of a template. The page is exactly the template's paper; the margin is 0 because
 * the boxes carry their own places (and a margin of 0 keeps the browser from printing its own date
 * and address in the corners).
 */
export function pageRule(template: Pick<PrintTemplate, 'pageWidthMm' | 'pageHeightMm'>): string {
  return `@page { size: ${mm(template.pageWidthMm)} ${mm(template.pageHeightMm)}; margin: 0; }`;
}

export function isEmptyItem(item: PrintItem): boolean {
  if ('text' in item) {
    return item.text.trim() === '';
  }
  if ('lines' in item) {
    return item.lines.every((line) => line.trim() === '');
  }
  return item.pairs.length === 0;
}

export function itemsByKey(items: PrintItem[]): Map<string, PrintItem> {
  return new Map(items.map((item) => [item.key, item]));
}

/**
 * Whether a box is drawn when PRINTING. Plain paper prints every box. Pre-printed stationery prints
 * only the VALUES inside text boxes: its letterhead, words, rules and logo are already on the paper.
 */
export function printsBox(template: Pick<PrintTemplate, 'mode'>, element: PrintElement): boolean {
  return template.mode === 'FULL' || element.type === 'RICH';
}

/** The place and size of a box, moved by the whole-sheet nudge. */
export function placeStyle(template: PrintTemplate, element: PrintElement): CSSProperties {
  return {
    left: mm(element.xMm + template.layout.offset.xMm),
    top: mm(element.yMm + template.layout.offset.yMm),
    width: mm(element.widthMm),
    height: mm(element.heightMm),
  };
}

/** The look of a stretch of text: its own size, bold, italic, underline (the page's size when none). */
export function runStyle(style: PrintStyle | undefined): CSSProperties {
  return {
    fontSize: style?.size !== undefined ? `${style.size}pt` : undefined,
    fontWeight: style?.bold ? 700 : undefined,
    fontStyle: style?.italic ? 'italic' : undefined,
    textDecoration: style?.underline ? 'underline' : undefined,
  };
}

const FONT_CLASS: Record<PrintFont, string> = {
  SANS: '',
  SERIF: 'print-font-serif',
  MONO: 'print-font-mono',
};
const TONE_CLASS: Record<PrintTone, string> = {
  BLACK: '',
  GREY: 'print-tone-grey',
};

/** The classes of a stretch (fonts and tones live in the stylesheet, never in the markup). */
export function runClasses(style: PrintStyle | undefined): string {
  return [FONT_CLASS[style?.font ?? 'SANS'], TONE_CLASS[style?.tone ?? 'BLACK']]
    .filter(Boolean)
    .join(' ');
}

export function alignStyle(align: PrintAlign | undefined): CSSProperties {
  return align ? { textAlign: align.toLowerCase() as CSSProperties['textAlign'] } : {};
}

/** The classes of a box: its kind (a line gets the tone of its colour). */
export function boxClasses(element: PrintElement): string {
  return [
    'print-box',
    `print-box-${element.type.toLowerCase()}`,
    element.type === 'LINE' ? TONE_CLASS[element.tone ?? 'BLACK'] : '',
  ]
    .filter(Boolean)
    .join(' ');
}
