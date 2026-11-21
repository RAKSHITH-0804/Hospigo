import type {
  PrintAlign,
  PrintContent,
  PrintElement,
  PrintItem,
  PrintParagraph,
  PrintRun,
  PrintStyle,
} from './types';
import { isEmptyItem } from './layout';

/**
 * The pure side of the rich text boxes: reading what is in a box, changing the style of all of it,
 * and deciding what prints. (The editor in the browser has its own file; this has no browser in it.)
 */

export const emptyContent = (): PrintContent => ({ paragraphs: [{ runs: [] }] });

/** A box of one paragraph with words and, if asked, a value after them. */
export function simpleContent(text: string, field?: string, style?: PrintStyle): PrintContent {
  const runs: PrintRun[] = [];
  if (text !== '') {
    runs.push(style ? { t: 'text', text, style } : { t: 'text', text });
  }
  if (field) {
    runs.push(style ? { t: 'field', field, style } : { t: 'field', field });
  }
  return { paragraphs: [{ runs }] };
}

export const allRuns = (content: PrintContent | undefined): PrintRun[] =>
  (content?.paragraphs ?? []).flatMap((p) => p.runs);

/** The values placed in a box, in order. */
export function fieldsInContent(content: PrintContent | undefined): string[] {
  return allRuns(content).flatMap((r) => (r.t === 'field' ? [r.field] : []));
}

/** All the typed words of a box, paragraphs on separate lines (values are not words). */
export function wordsOf(content: PrintContent | undefined): string {
  return (content?.paragraphs ?? [])
    .map((p) => p.runs.map((r) => (r.t === 'text' ? r.text : '')).join(''))
    .join('\n');
}

/** A box with nothing in it: no words and no values. */
export const isEmptyContent = (content: PrintContent | undefined): boolean =>
  allRuns(content).length === 0;

/** Every value placed anywhere on the page. */
export function fieldsOnPage(elements: readonly PrintElement[]): Set<string> {
  return new Set(elements.flatMap((e) => fieldsInContent(e.content)));
}

// ------------------------------------------------------------------ changing all of a box

const KEYS: ReadonlyArray<keyof PrintStyle> = [
  'size',
  'bold',
  'italic',
  'underline',
  'font',
  'tone',
];

/** A style with only the settings that matter (an unset or default one is not stored). */
export function cleanStyle(style: PrintStyle | undefined): PrintStyle | undefined {
  if (!style) {
    return undefined;
  }
  const out: PrintStyle = {};
  if (style.size !== undefined) out.size = style.size;
  if (style.bold) out.bold = true;
  if (style.italic) out.italic = true;
  if (style.underline) out.underline = true;
  if (style.font && style.font !== 'SANS') out.font = style.font;
  if (style.tone && style.tone !== 'BLACK') out.tone = style.tone;
  return Object.keys(out).length > 0 ? out : undefined;
}

function withStyle(run: PrintRun, style: PrintStyle | undefined): PrintRun {
  const clean = cleanStyle(style);
  const { style: _old, ...rest } = run;
  return clean ? ({ ...rest, style: clean } as PrintRun) : (rest as PrintRun);
}

/** Changes the style of every stretch in a box (the whole box selected, as in a word processor). */
export function styleAll(content: PrintContent, patch: Partial<PrintStyle>): PrintContent {
  return {
    paragraphs: content.paragraphs.map((p) => ({
      ...p,
      runs: p.runs.map((r) => withStyle(r, { ...r.style, ...patch })),
    })),
  };
}

/**
 * What is true of ALL the stretches of a box: a setting every stretch has the same (the value),
 * and nothing for a setting that differs (mixed) or a box with no stretch.
 */
export function commonStyle(content: PrintContent | undefined): PrintStyle {
  const runs = allRuns(content);
  const out: PrintStyle = {};
  if (runs.length === 0) {
    return out;
  }
  const first = runs[0]!.style ?? {};
  for (const key of KEYS) {
    const same = runs.every((r) => (r.style?.[key] ?? undefined) === (first[key] ?? undefined));
    if (same && first[key] !== undefined) {
      (out as Record<string, unknown>)[key] = first[key];
    }
  }
  return out;
}

/** Switch bold, italic or underline on for the whole box, or off when it is already on everywhere. */
export function toggleAll(
  content: PrintContent,
  key: 'bold' | 'italic' | 'underline',
): PrintContent {
  const runs = allRuns(content);
  const allOn = runs.length > 0 && runs.every((r) => r.style?.[key] === true);
  return styleAll(content, { [key]: !allOn });
}

export function alignAll(content: PrintContent, align: PrintAlign): PrintContent {
  return {
    paragraphs: content.paragraphs.map((p) =>
      align === 'LEFT' ? { runs: p.runs } : { align, runs: p.runs },
    ),
  };
}

/** The alignment all paragraphs share (left when none is set). */
export function commonAlign(content: PrintContent | undefined): PrintAlign | undefined {
  const aligns = (content?.paragraphs ?? []).map((p) => p.align ?? 'LEFT');
  return aligns.length > 0 && aligns.every((a) => a === aligns[0]) ? aligns[0] : undefined;
}

/** Puts a value at the end of the last paragraph (inserting a value into a box that is not being edited). */
export function appendField(content: PrintContent, field: string): PrintContent {
  const paragraphs = content.paragraphs.length > 0 ? [...content.paragraphs] : [{ runs: [] }];
  const last = paragraphs[paragraphs.length - 1]!;
  const style = cleanStyle(last.runs.at(-1)?.style);
  const run: PrintRun = style ? { t: 'field', field, style } : { t: 'field', field };
  paragraphs[paragraphs.length - 1] = { ...last, runs: [...last.runs, run] };
  return { paragraphs };
}

/** Takes a value out of a box. */
export function dropField(content: PrintContent, field: string): PrintContent {
  const paragraphs = content.paragraphs.map((p) => ({
    ...p,
    runs: p.runs.filter((r) => !(r.t === 'field' && r.field === field)),
  }));
  return { paragraphs: paragraphs.length > 0 ? paragraphs : [{ runs: [] }] };
}

// ------------------------------------------------------------------ what prints

export type ShownParagraph = { align?: PrintAlign; runs: PrintRun[] };

/**
 * The paragraphs of a box that PRINT.
 *  - Plain paper: every paragraph. A paragraph that holds values and all of them are empty is left
 *    out, words and all ("Phone:" alone says nothing).
 *  - Pre-printed stationery (`valuesOnly`): only the values (the stationery has the words), and only
 *    the ones that have something to print.
 * Returns an empty list when nothing is to be printed.
 */
export function shownParagraphs(
  content: PrintContent | undefined,
  byKey: ReadonlyMap<string, PrintItem>,
  valuesOnly: boolean,
): ShownParagraph[] {
  const has = (run: PrintRun): boolean => {
    if (run.t !== 'field') {
      return false;
    }
    const item = byKey.get(run.field);
    return !!item && !isEmptyItem(item);
  };
  const out: ShownParagraph[] = [];
  for (const p of content?.paragraphs ?? []) {
    const hasValues = p.runs.some((r) => r.t === 'field');
    if (valuesOnly) {
      const runs = p.runs.filter(has);
      if (runs.length > 0) {
        out.push({ ...(p.align ? { align: p.align } : {}), runs });
      }
      continue;
    }
    if (hasValues && !p.runs.some(has)) {
      continue;
    }
    out.push({ ...(p.align ? { align: p.align } : {}), runs: p.runs });
  }
  return out;
}

export type { PrintParagraph };
