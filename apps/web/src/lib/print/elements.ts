import { printDesignerConfig as C } from '@/config/print';
import { staffCopy } from '@/config/staff-copy';
import { clampBox, round1, type Page } from './geometry';
import { dropField, emptyContent, isEmptyContent, simpleContent } from './rich';
import type { PrintElement } from './types';

/** An id no other box uses ("e1", "e2", ...). */
export function nextId(elements: readonly PrintElement[]): string {
  const used = new Set(elements.map((e) => e.id));
  let n = elements.length + 1;
  while (used.has(`e${n}`)) {
    n += 1;
  }
  return `e${n}`;
}

/** Height of a box that starts `lines` text lines tall. */
export function linesHeightMm(fontSizePt: number, lines: number): number {
  return round1(fontSizePt * C.mmPerPt * C.lineFactor * lines);
}

/** The lowest edge of any box (where a new box goes below). */
function lowestMm(elements: readonly PrintElement[]): number {
  return elements.length === 0 ? 0 : Math.max(...elements.map((e) => e.yMm + e.heightMm));
}

/** Where a new box of this size starts: left, below everything, and back on the page if that is past the end. */
function placed(
  elements: readonly PrintElement[],
  page: Page,
  widthMm: number,
  heightMm: number,
  minHeight: number,
) {
  const margin = Math.min(10, page.widthMm / 10);
  const y = elements.length === 0 ? margin : lowestMm(elements) + C.newBoxGapMm;
  return clampBox({ xMm: margin, yMm: y, widthMm, heightMm }, page, C.minBoxMm, minHeight);
}

/** A box with a value of the document in it, and (when asked) the words in front of it, as ordinary bold text. */
export function newFieldBox(
  elements: readonly PrintElement[],
  page: Page,
  field: string,
  fontSizePt: number,
  withCaption: boolean,
): PrintElement {
  const lines = C.listFields.includes(field) ? C.newListFieldLines : C.newFieldLines;
  const caption = `${staffCopy.print.fields[field] ?? field}: `;
  return {
    id: nextId(elements),
    type: 'RICH',
    // The words in front are ordinary bold text: a person can retype or restyle them like any other.
    content: withCaption
      ? {
          paragraphs: [
            {
              runs: [
                { t: 'text', text: caption, style: { bold: true } },
                { t: 'field', field },
              ],
            },
          ],
        }
      : simpleContent('', field),
    ...placed(elements, page, C.newFieldWidthMm, linesHeightMm(fontSizePt, lines), C.minBoxMm),
  };
}

export function newTextBox(
  elements: readonly PrintElement[],
  page: Page,
  text: string,
  fontSizePt: number,
): PrintElement {
  return {
    id: nextId(elements),
    type: 'RICH',
    content: text === '' ? emptyContent() : simpleContent(text),
    ...placed(elements, page, C.newTextWidthMm, linesHeightMm(fontSizePt, 1), C.minBoxMm),
  };
}

export function newLineBox(elements: readonly PrintElement[], page: Page): PrintElement {
  return {
    id: nextId(elements),
    type: 'LINE',
    ...placed(elements, page, C.newLineWidthMm, C.newLineHeightMm, C.minLineMm),
  };
}

export function newLogoBox(elements: readonly PrintElement[], page: Page): PrintElement {
  return {
    id: nextId(elements),
    type: 'IMAGE',
    slot: 'LOGO',
    ...placed(elements, page, C.newLogoWidthMm, C.newLogoHeightMm, C.minBoxMm),
  };
}

export function newSignatureBox(elements: readonly PrintElement[], page: Page): PrintElement {
  return {
    id: nextId(elements),
    type: 'IMAGE',
    slot: 'SIGNATURE',
    ...placed(elements, page, C.newSignatureWidthMm, C.newSignatureHeightMm, C.minBoxMm),
  };
}

/** A copy a few millimetres away from the original. */
export function duplicateBox(
  elements: readonly PrintElement[],
  source: PrintElement,
  page: Page,
): PrintElement {
  const min = source.type === 'LINE' ? C.minLineMm : C.minBoxMm;
  return {
    ...JSON.parse(JSON.stringify(source)),
    id: nextId(elements),
    ...clampBox(
      {
        xMm: source.xMm + C.duplicateOffsetMm,
        yMm: source.yMm + C.duplicateOffsetMm,
        widthMm: source.widthMm,
        heightMm: source.heightMm,
      },
      page,
      min,
      min,
    ),
  };
}

export function replaceBox(
  elements: readonly PrintElement[],
  id: string,
  change: Partial<PrintElement>,
): PrintElement[] {
  return elements.map((e) => (e.id === id ? { ...e, ...change } : e));
}

export function removeBox(elements: readonly PrintElement[], id: string): PrintElement[] {
  return elements.filter((e) => e.id !== id);
}

/** Later boxes are drawn on top: forward moves a box one step later, backward one step earlier. */
export function moveInOrder(
  elements: readonly PrintElement[],
  id: string,
  direction: 1 | -1,
): PrintElement[] {
  const index = elements.findIndex((e) => e.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= elements.length) {
    return [...elements];
  }
  const out = [...elements];
  [out[index], out[target]] = [out[target]!, out[index]!];
  return out;
}

/**
 * Takes a value off the page: out of every box that holds it. A box left with nothing in it (it was
 * only that value) goes too; a box with other words or values stays.
 */
export function removeField(elements: readonly PrintElement[], field: string): PrintElement[] {
  return elements.flatMap((e) => {
    if (e.type !== 'RICH' || !e.content) {
      return [e];
    }
    const before = e.content;
    const after = dropField(before, field);
    if (JSON.stringify(after) === JSON.stringify(before)) {
      return [e];
    }
    // the words of "Patient: " alone are not worth keeping once the value is gone
    const onlyCaption = after.paragraphs.every((p) => p.runs.every((r) => r.t === 'text'));
    const hadOnlyThis = before.paragraphs.length === 1 && before.paragraphs[0]!.runs.length <= 2;
    return isEmptyContent(after) || (hadOnlyThis && onlyCaption) ? [] : [{ ...e, content: after }];
  });
}
