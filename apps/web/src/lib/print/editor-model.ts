import type {
  PrintAlign,
  PrintContent,
  PrintFont,
  PrintParagraph,
  PrintRun,
  PrintStyle,
  PrintTone,
} from './types';
import { cleanStyle } from './rich';

/**
 * Conversion between the text of a box as the template stores it and the document the editor works
 * on (TipTap). Pure functions, no browser. The way back is a WHITELIST: only paragraphs, words with
 * the known styles and the value tokens come through, whatever was pasted or typed.
 */
export type TipMark = { type: string; attrs?: Record<string, unknown> };
export type TipNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipNode[];
  text?: string;
  marks?: TipMark[];
};

/** The longest stretch the API takes; longer words are cut into stretches of this size. */
export const RUN_TEXT_MAX = 300;

const TIP_ALIGN: Record<PrintAlign, string> = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' };

function marksOf(style: PrintStyle | undefined): TipMark[] | undefined {
  const s = cleanStyle(style);
  if (!s) {
    return undefined;
  }
  const marks: TipMark[] = [];
  if (s.bold) marks.push({ type: 'bold' });
  if (s.italic) marks.push({ type: 'italic' });
  if (s.underline) marks.push({ type: 'underline' });
  const attrs: Record<string, unknown> = {};
  if (s.size !== undefined) attrs.printSize = s.size;
  if (s.font) attrs.printFont = s.font;
  if (s.tone) attrs.printTone = s.tone;
  if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs });
  return marks.length > 0 ? marks : undefined;
}

/** The text of a box as an editor document. */
export function contentToTip(content: PrintContent): TipNode {
  return {
    type: 'doc',
    content: content.paragraphs.map((p): TipNode => {
      const nodes: TipNode[] = p.runs.map((r): TipNode => {
        const marks = marksOf(r.style);
        return r.t === 'text'
          ? { type: 'text', text: r.text, ...(marks ? { marks } : {}) }
          : { type: 'fieldToken', attrs: { field: r.field }, ...(marks ? { marks } : {}) };
      });
      return {
        type: 'paragraph',
        ...(p.align ? { attrs: { textAlign: TIP_ALIGN[p.align] } } : {}),
        ...(nodes.length > 0 ? { content: nodes } : {}),
      };
    }),
  };
}

function styleOfMarks(marks: TipMark[] | undefined): PrintStyle | undefined {
  const style: PrintStyle = {};
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') style.bold = true;
    else if (mark.type === 'italic') style.italic = true;
    else if (mark.type === 'underline') style.underline = true;
    else if (mark.type === 'textStyle') {
      const a = mark.attrs ?? {};
      if (typeof a.printSize === 'number' && Number.isFinite(a.printSize)) {
        style.size = Math.round(a.printSize * 10) / 10;
      }
      if (a.printFont === 'SERIF' || a.printFont === 'MONO') style.font = a.printFont as PrintFont;
      if (a.printTone === 'GREY') style.tone = a.printTone as PrintTone;
    }
  }
  return cleanStyle(style);
}

const sameStyle = (a: PrintStyle | undefined, b: PrintStyle | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The text of an editor document as a box's content. Anything that is not a paragraph, words or a
 * value token is dropped; line breaks inside words become spaces; neighbouring words of the same
 * style are one stretch; very long words are cut into stretches the API accepts. A document with
 * nothing in it is one empty paragraph.
 */
export function tipToContent(doc: unknown): PrintContent {
  const root = doc as TipNode | null;
  const paragraphs: PrintParagraph[] = [];
  for (const node of root?.content ?? []) {
    if (node?.type !== 'paragraph') {
      continue;
    }
    const runs: PrintRun[] = [];
    for (const child of node.content ?? []) {
      const style = styleOfMarks(child.marks);
      if (
        child.type === 'fieldToken' &&
        typeof child.attrs?.field === 'string' &&
        child.attrs.field
      ) {
        runs.push(
          style
            ? { t: 'field', field: child.attrs.field, style }
            : { t: 'field', field: child.attrs.field },
        );
      } else if (child.type === 'text' && typeof child.text === 'string') {
        const clean = child.text.replace(/[\r\n]+/g, ' ');
        for (let at = 0; at < clean.length; at += RUN_TEXT_MAX) {
          const text = clean.slice(at, at + RUN_TEXT_MAX);
          const last = runs.at(-1);
          if (
            last?.t === 'text' &&
            sameStyle(last.style, style) &&
            last.text.length + text.length <= RUN_TEXT_MAX
          ) {
            last.text += text;
          } else {
            runs.push(style ? { t: 'text', text, style } : { t: 'text', text });
          }
        }
      }
    }
    const align = node.attrs?.textAlign;
    paragraphs.push({
      ...(align === 'center'
        ? { align: 'CENTER' as const }
        : align === 'right'
          ? { align: 'RIGHT' as const }
          : {}),
      runs,
    });
  }
  return { paragraphs: paragraphs.length > 0 ? paragraphs : [{ runs: [] }] };
}
