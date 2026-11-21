'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { RichEditor } from '@/components/print/rich-editor';
import { BoxContent } from '@/components/print/print-sheet';
import { printDesignerConfig as C } from '@/config/print';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';
import {
  HANDLES,
  handleCursor,
  moveBox,
  nudgeBox,
  resizeBox,
  type Handle,
} from '@/lib/print/geometry';
import { boxClasses, itemsByKey, mm, placeStyle, printsBox } from '@/lib/print/layout';
import { fieldsInContent, wordsOf } from '@/lib/print/rich';
import type { PrintContent, PrintElement, PrintItem, PrintTemplate } from '@/lib/print/types';
import { zoomPctFor, type ZoomChoice } from '@/lib/print/zoom';

const copy = staffCopy.settings.printing;

type Drag = {
  id: string;
  kind: 'move' | Handle;
  startX: number;
  startY: number;
  original: PrintElement;
};

/**
 * A name for a box when it is announced or listed: its first words ("Patient"), else the first
 * value in it, else "Text box" (a line and a logo box have their own names).
 */
export function boxName(element: PrintElement): string {
  if (element.type === 'LINE') {
    return copy.boxLine;
  }
  if (element.type === 'IMAGE') {
    return element.slot === 'SIGNATURE' ? copy.boxSignature : copy.boxLogo;
  }
  const words = wordsOf(element.content).replace(/\s+/g, ' ').trim().replace(/:$/, '').trim();
  if (words) {
    return words.length > 30 ? `${words.slice(0, 30)}…` : words;
  }
  const field = fieldsInContent(element.content)[0];
  return field ? (staffCopy.print.fields[field] ?? field) : copy.boxText;
}

const minOf = (element: PrintElement) => (element.type === 'LINE' ? C.minLineMm : C.minBoxMm);

function Ruler({ lengthMm, vertical }: { lengthMm: number; vertical?: boolean }) {
  const marks: number[] = [];
  for (let at = 0; at <= lengthMm; at += C.rulerTickMm) {
    marks.push(at);
  }
  return (
    <div
      className={cn('print-ruler', vertical ? 'print-ruler-vertical' : 'print-ruler-horizontal')}
      aria-hidden="true"
      style={vertical ? { height: mm(lengthMm) } : { width: mm(lengthMm) }}
    >
      {marks.map((at) => (
        <span
          key={at}
          className="print-ruler-mark"
          style={vertical ? { top: mm(at) } : { left: mm(at) }}
        >
          {at}
        </span>
      ))}
    </div>
  );
}

/**
 * The page as it is designed: the boxes at their real places (drawn by the same code that prints),
 * with rulers in millimetres. A click selects a box, a drag moves it, the eight handles resize it,
 * the arrow keys nudge it (Shift for more, Alt for a fine step), Delete removes it. While a
 * drag is going on the new place is only a draft; one step is recorded when the mouse is let go.
 */
export function PrintCanvas({
  template,
  items,
  selectedId,
  zoom,
  snapMm,
  readOnly,
  onSelect,
  onDraft,
  onCommit,
  onRemove,
  onDuplicate,
  onUndo,
  onRedo,
  editingId,
  onEdit,
  onEditorReady,
  onEditorChange,
  onStopEditing,
  labels,
}: {
  template: PrintTemplate;
  items: PrintItem[];
  selectedId: string | null;
  zoom: ZoomChoice;
  snapMm: number;
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  /** The boxes while a drag is going on (not a step yet). */
  onDraft: (elements: PrintElement[]) => void;
  /** The boxes after a change (one step). */
  onCommit: (elements: PrintElement[]) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** The box whose text is being typed in, if any. */
  editingId: string | null;
  /** Start typing in a text box (double click, Enter, F2). */
  onEdit: (id: string) => void;
  onEditorReady: (editor: Editor | null) => void;
  /** The text of the box being typed in, after every change. */
  onEditorChange: (content: PrintContent) => void;
  onStopEditing: () => void;
  /** The words shown in a value chip, by field. */
  labels: Record<string, string>;
}) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  // The room the page has, measured again whenever the window or the layout changes size.
  const [room, setRoom] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = frame.current;
    if (!element) {
      return;
    }
    const measure = () =>
      setRoom({
        width: element.clientWidth,
        height: Math.max(0, window.innerHeight - C.fitPageReservePx),
      });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const page = { widthMm: template.pageWidthMm, heightMm: template.pageHeightMm };
  const zoomPct = zoomPctFor(zoom, room.width, room.height, page);
  const scale = zoomPct / 100;
  const pxPerMm = C.pxPerMm * scale;
  const byKey = itemsByKey(items);
  const elements = template.layout.elements;

  const replace = (id: string, box: Partial<PrintElement>): PrintElement[] =>
    elements.map((e) => (e.id === id ? { ...e, ...box } : e));

  function start(event: PointerEvent<HTMLElement>, element: PrintElement, kind: Drag['kind']) {
    event.stopPropagation();
    // While the text of this box is being typed, clicks belong to the text: no selecting, no dragging.
    if (editingId === element.id) {
      return;
    }
    onSelect(element.id);
    if (readOnly || event.button > 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      id: element.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      original: element,
    };
  }

  function next(event: PointerEvent<HTMLElement>): PrintElement[] | null {
    const d = drag.current;
    if (!d) {
      return null;
    }
    const dx = (event.clientX - d.startX) / pxPerMm;
    const dy = (event.clientY - d.startY) / pxPerMm;
    const min = minOf(d.original);
    const box =
      d.kind === 'move'
        ? moveBox(d.original, dx, dy, page, snapMm)
        : resizeBox(d.original, d.kind, dx, dy, page, snapMm, min, min);
    return replace(d.id, box);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const out = next(event);
    if (out) {
      onDraft(out);
    }
  }

  function end(event: PointerEvent<HTMLElement>) {
    const out = next(event);
    drag.current = null;
    if (out) {
      onCommit(out);
    }
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    // Typing in a box is the editor's: its keys are not shortcuts of the page.
    if (editingId) {
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (!readOnly) (event.shiftKey ? onRedo : onUndo)();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (!readOnly) onRedo();
      return;
    }
    const selected = elements.find((e) => e.id === selectedId);
    if (!selected || readOnly) {
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(selected.id);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'F2') && selected.type === 'RICH') {
      event.preventDefault();
      onEdit(selected.id);
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      onDuplicate(selected.id);
      return;
    }
    const step = event.altKey ? C.nudgeFineMm : event.shiftKey ? C.nudgeBigMm : C.nudgeMm;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (d) {
      event.preventDefault();
      onCommit(replace(selected.id, nudgeBox(selected, d[0], d[1], page)));
    }
  }

  return (
    <div className="print-canvas-frame" ref={frame} data-zoom={zoomPct}>
      <div
        className="print-canvas-scaled"
        style={{
          width: `calc((${mm(page.widthMm)} + var(--size-ruler)) * ${scale})`,
          height: `calc((${mm(page.heightMm)} + var(--size-ruler)) * ${scale})`,
        }}
      >
        <div
          className="print-canvas-grid"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <Ruler lengthMm={page.widthMm} />
          <Ruler lengthMm={page.heightMm} vertical />
          <div
            className="print-canvas"
            tabIndex={0}
            role="application"
            aria-label={copy.canvasAria}
            onKeyDown={keys}
            onPointerDown={() => onSelect(null)}
            style={{ width: mm(page.widthMm), height: mm(page.heightMm) }}
          >
            <div
              className="print-sheet print-canvas-sheet"
              data-mode={template.mode}
              style={{
                width: mm(page.widthMm),
                height: mm(page.heightMm),
                fontSize: `${template.layout.fontSizePt}pt`,
              }}
            >
              {template.mode === 'FULL' ? (
                <span
                  className="print-margin-guide"
                  aria-hidden="true"
                  style={{
                    left: mm(template.margins.leftMm),
                    top: mm(template.margins.topMm),
                    right: mm(template.margins.rightMm),
                    bottom: mm(template.margins.bottomMm),
                  }}
                />
              ) : null}
              {elements.map((element) => {
                const selected = element.id === selectedId;
                const editing = element.id === editingId;
                const ghost = !printsBox(template, element);
                return (
                  <div
                    key={element.id}
                    className={cn(
                      boxClasses(element),
                      'designer-box',
                      selected && 'is-selected',
                      editing && 'is-editing',
                      ghost && 'is-ghost',
                    )}
                    data-box={element.id}
                    role="button"
                    aria-label={boxName(element)}
                    aria-pressed={selected}
                    style={placeStyle(template, element)}
                    onPointerDown={(event) => start(event, element, 'move')}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    onDoubleClick={() => {
                      if (!readOnly && element.type === 'RICH') {
                        onEdit(element.id);
                      }
                    }}
                  >
                    {editing && element.content ? (
                      <RichEditor
                        content={element.content}
                        labels={labels}
                        onReady={onEditorReady}
                        onChange={onEditorChange}
                        onExit={onStopEditing}
                      />
                    ) : (
                      <BoxContent
                        element={element}
                        byKey={byKey}
                        valuesOnly={false}
                        everything
                        placeholder={
                          element.slot === 'SIGNATURE' ? copy.signatureMarker : copy.logoMarker
                        }
                      />
                    )}
                    {selected && !editing && !readOnly
                      ? HANDLES.map((handle) => (
                          <span
                            key={handle}
                            role="presentation"
                            aria-label={copy.handleAria}
                            data-handle={handle}
                            className={`print-handle print-handle-${handle}`}
                            style={{ cursor: handleCursor(handle) }}
                            onPointerDown={(event) => start(event, element, handle)}
                            onPointerMove={move}
                            onPointerUp={end}
                            onPointerCancel={end}
                          />
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
