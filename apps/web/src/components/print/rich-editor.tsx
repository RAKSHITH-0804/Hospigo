'use client';

import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { useEffect, useRef } from 'react';
import { staffCopy } from '@/config/staff-copy';
import { contentToTip, tipToContent } from '@/lib/print/editor-model';
import type { PrintAlign, PrintContent, PrintFont, PrintStyle, PrintTone } from '@/lib/print/types';

/**
 * The editor inside a text box while it is being edited (TipTap). It is a plain word processor line
 * of work: type, select, make words bold, change their size, align a paragraph, put a value of the
 * document (a "field") inside the words. The text is kept as a small whitelist of things (see
 * editor-model.ts); nothing else the editor could hold ever reaches the template.
 */

/** Size, font and colour of a stretch, carried by TipTap's text style mark. */
const PrintTextStyle = Extension.create({
  name: 'printTextStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          printSize: {
            default: null,
            parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-size')) || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.printSize
                ? { 'data-size': String(attrs.printSize), style: `font-size: ${attrs.printSize}pt` }
                : {},
          },
          printFont: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-font') || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.printFont
                ? {
                    'data-font': String(attrs.printFont),
                    class: attrs.printFont === 'MONO' ? 'print-font-mono' : 'print-font-serif',
                  }
                : {},
          },
          printTone: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-tone') || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.printTone
                ? { 'data-tone': String(attrs.printTone), class: 'print-tone-grey' }
                : {},
          },
        },
      },
    ];
  },
});

/** A value of the document inside the words, like a mail-merge field. It is one piece: deleted as a whole. */
const FieldToken = Node.create<{ labels: Record<string, string> }>({
  name: 'fieldToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { labels: {} };
  },
  addAttributes() {
    return { field: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-field-token]',
        getAttrs: (el) => ({ field: (el as HTMLElement).getAttribute('data-field-token') ?? '' }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const field = String(node.attrs.field);
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-field-token': field, class: 'print-token' }),
      `{${this.options.labels[field] ?? field}}`,
    ];
  },
});

export function RichEditor({
  content,
  labels,
  onReady,
  onChange,
  onExit,
}: {
  content: PrintContent;
  /** The words shown inside a value chip, by field. */
  labels: Record<string, string>;
  /** The editor, when it exists (null when it goes away), so the ribbon can drive it. */
  onReady: (editor: Editor | null) => void;
  /** The text after every change, in the form the template stores. */
  onChange: (content: PrintContent) => void;
  /** Escape was pressed: stop editing. */
  onExit: () => void;
}) {
  const exit = useRef(onExit);
  exit.current = onExit;
  const ready = useRef(onReady);
  ready.current = onReady;
  const changed = useRef(onChange);
  changed.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: 'end',
    content: contentToTip(content),
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false,
        hardBreak: false,
        dropcursor: false,
        gapcursor: false,
        listKeymap: false,
        trailingNode: false,
      }),
      TextStyle,
      PrintTextStyle,
      TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'] }),
      FieldToken.configure({ labels }),
    ],
    onUpdate: ({ editor: updated }) => changed.current(tipToContent(updated.getJSON())),
    editorProps: {
      attributes: {
        class: 'print-editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': staffCopy.settings.printing.editorAria,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          exit.current();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    ready.current(editor);
    return () => ready.current(null);
  }, [editor]);

  return <EditorContent editor={editor} className="print-editor-host" />;
}

// ---------------------------------------------------------------- commands the ribbon uses

/** The style at the cursor (or of the selection), as the ribbon shows it. */
export function styleAtCursor(editor: Editor): PrintStyle & { align?: PrintAlign } {
  const text = editor.getAttributes('textStyle') as Record<string, unknown>;
  const align = editor.getAttributes('paragraph').textAlign;
  return {
    ...(typeof text.printSize === 'number' ? { size: text.printSize } : {}),
    ...(editor.isActive('bold') ? { bold: true } : {}),
    ...(editor.isActive('italic') ? { italic: true } : {}),
    ...(editor.isActive('underline') ? { underline: true } : {}),
    ...(text.printFont === 'SERIF' || text.printFont === 'MONO'
      ? { font: text.printFont as PrintFont }
      : {}),
    ...(text.printTone === 'GREY' ? { tone: 'GREY' as PrintTone } : {}),
    align: align === 'center' ? 'CENTER' : align === 'right' ? 'RIGHT' : 'LEFT',
  };
}

/** Size, font or colour for the selected words (or the words typed next). */
export function setRunStyle(
  editor: Editor,
  patch: { size?: number | null; font?: PrintFont | null; tone?: PrintTone | null },
): void {
  const current = editor.getAttributes('textStyle') as Record<string, unknown>;
  const next = {
    printSize: 'size' in patch ? patch.size : current.printSize,
    printFont: 'font' in patch ? patch.font : current.printFont,
    printTone: 'tone' in patch ? patch.tone : current.printTone,
  };
  const chain = editor.chain().focus();
  if (next.printSize == null && next.printFont == null && next.printTone == null) {
    chain.unsetMark('textStyle').run();
  } else {
    chain.setMark('textStyle', next).run();
  }
}

export function toggleRunMark(editor: Editor, mark: 'bold' | 'italic' | 'underline'): void {
  const chain = editor.chain().focus();
  if (mark === 'bold') chain.toggleBold().run();
  else if (mark === 'italic') chain.toggleItalic().run();
  else chain.toggleUnderline().run();
}

export function setParagraphAlign(editor: Editor, align: PrintAlign): void {
  editor.chain().focus().setTextAlign(align.toLowerCase()).run();
}

/** A value of the document at the cursor, as one piece. */
export function insertValue(editor: Editor, field: string): void {
  editor.chain().focus().insertContent({ type: 'fieldToken', attrs: { field } }).run();
}
