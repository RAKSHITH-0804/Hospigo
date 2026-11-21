'use client';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  Copy,
  Image as ImageIcon,
  Italic,
  Minus,
  Pencil,
  Redo2,
  SendToBack,
  Trash2,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { boxName } from '@/components/print/print-canvas';
import { NumberField } from '@/components/print/number-field';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { printDesignerConfig as C } from '@/config/print';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import type { PrintAlign, PrintElement, PrintFont, PrintStyle, PrintTone } from '@/lib/print/types';

const copy = staffCopy.settings.printing;

function IconButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? 'default' : 'outline'}
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Pressing a ribbon button must not take the cursor out of the text being edited.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** The style the ribbon shows: the words at the cursor while typing, all of the box otherwise. */
export type RibbonStyle = PrintStyle & { align?: PrintAlign };

/**
 * The ribbon of the page designer, like that of a word processor. For a text box: size, font, bold,
 * italic, underline, alignment, colour and Insert value, acting on the SELECTED WORDS while the text
 * is being edited and on the whole box otherwise. For any box: its exact place and size, order,
 * duplicate and delete. Add text, line and logo, undo and redo are always here.
 */
export function PrintToolbar({
  selected,
  editing,
  readOnly,
  full,
  canUndo,
  canRedo,
  atMax,
  defaultPt,
  style,
  valueChoices,
  onSize,
  onToggle,
  onFont,
  onTone,
  onAlign,
  onInsertValue,
  onEditText,
  onGeometry,
  onLineTone,
  onAddText,
  onAddLine,
  onAddLogo,
  onDuplicate,
  onRemove,
  onForward,
  onBackward,
  onUndo,
  onRedo,
}: {
  selected: PrintElement | null;
  /** The text of the selected box is being typed in. */
  editing: boolean;
  readOnly: boolean;
  /** Plain paper: letterhead boxes (text, line, logo) can be added. */
  full: boolean;
  canUndo: boolean;
  canRedo: boolean;
  atMax: boolean;
  defaultPt: number;
  style: RibbonStyle;
  valueChoices: Array<{ key: string; label: string }>;
  onSize: (pt: number) => void;
  onToggle: (mark: 'bold' | 'italic' | 'underline') => void;
  onFont: (font: PrintFont) => void;
  onTone: (tone: PrintTone) => void;
  onAlign: (align: PrintAlign) => void;
  onInsertValue: (field: string) => void;
  onEditText: () => void;
  onGeometry: (change: Partial<Pick<PrintElement, 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>>) => void;
  onLineTone: (tone: PrintTone) => void;
  onAddText: () => void;
  onAddLine: () => void;
  onAddLogo: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onForward: () => void;
  onBackward: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const off = readOnly;
  const rich = selected?.type === 'RICH';

  return (
    <div className="print-toolbar" role="toolbar" aria-label={copy.toolbarAria}>
      <div className="print-toolbar-row">
        <IconButton label={copy.undo} disabled={off || !canUndo || editing} onClick={onUndo}>
          <Undo2 aria-hidden="true" />
        </IconButton>
        <IconButton label={copy.redo} disabled={off || !canRedo || editing} onClick={onRedo}>
          <Redo2 aria-hidden="true" />
        </IconButton>
        <span className="print-toolbar-gap" />
        <Button
          type="button"
          variant="outline"
          disabled={off || atMax || !full}
          onClick={onAddText}
        >
          <Type aria-hidden="true" /> {copy.addText}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={off || atMax || !full}
          onClick={onAddLine}
        >
          <Minus aria-hidden="true" /> {copy.addLine}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={off || atMax || !full}
          onClick={onAddLogo}
        >
          <ImageIcon aria-hidden="true" /> {copy.addLogo}
        </Button>
        {atMax ? (
          <span className="type-small text-muted-foreground">
            {fill(copy.tooManyBoxes, { max: C.maxElements })}
          </span>
        ) : null}
      </div>

      {selected ? (
        <>
          <p className="type-label-strong" aria-live="polite">
            {fill(copy.selectedBox, { name: boxName(selected) })}
          </p>
          {rich ? (
            <>
              <div className="print-toolbar-row">
                <NumberField
                  label={copy.sizeLabel}
                  value={style.size ?? defaultPt}
                  disabled={off}
                  onChange={(pt) =>
                    onSize(Math.min(C.fontMaxPt, Math.max(C.fontMinPt, Math.round(pt * 10) / 10)))
                  }
                />
                <SelectField
                  label={copy.fontFamilyLabel}
                  value={style.font ?? 'SANS'}
                  disabled={off}
                  onChange={(event) => onFont(event.target.value as PrintFont)}
                >
                  <option value="SANS">{copy.fontSans}</option>
                  <option value="SERIF">{copy.fontSerif}</option>
                  <option value="MONO">{copy.fontMono}</option>
                </SelectField>
                <IconButton
                  label={copy.bold}
                  pressed={style.bold === true}
                  disabled={off}
                  onClick={() => onToggle('bold')}
                >
                  <Bold aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={copy.italic}
                  pressed={style.italic === true}
                  disabled={off}
                  onClick={() => onToggle('italic')}
                >
                  <Italic aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={copy.underline}
                  pressed={style.underline === true}
                  disabled={off}
                  onClick={() => onToggle('underline')}
                >
                  <Underline aria-hidden="true" />
                </IconButton>
                {(
                  [
                    ['LEFT', copy.alignLeft, AlignLeft],
                    ['CENTER', copy.alignCenter, AlignCenter],
                    ['RIGHT', copy.alignRight, AlignRight],
                  ] as const
                ).map(([align, label, Icon]) => (
                  <IconButton
                    key={align}
                    label={label}
                    pressed={(style.align ?? 'LEFT') === align}
                    disabled={off}
                    onClick={() => onAlign(align)}
                  >
                    <Icon aria-hidden="true" />
                  </IconButton>
                ))}
                <SelectField
                  label={copy.toneLabel}
                  value={style.tone ?? 'BLACK'}
                  disabled={off}
                  onChange={(event) => onTone(event.target.value as PrintTone)}
                >
                  <option value="BLACK">{copy.toneBlack}</option>
                  <option value="GREY">{copy.toneGrey}</option>
                </SelectField>
                <SelectField
                  label={copy.insertValue}
                  hint={copy.insertValueHint}
                  value=""
                  disabled={off}
                  onChange={(event) => {
                    if (event.target.value) {
                      onInsertValue(event.target.value);
                    }
                  }}
                >
                  <option value="">{copy.insertValueChoose}</option>
                  {valueChoices.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </SelectField>
                {editing ? null : (
                  <Button type="button" variant="outline" disabled={off} onClick={onEditText}>
                    <Pencil aria-hidden="true" /> {copy.editText}
                  </Button>
                )}
              </div>
              <p className="type-small text-muted-foreground">
                {editing ? copy.editingHint : copy.doubleClickHint}
              </p>
            </>
          ) : null}
          {selected.type === 'LINE' ? (
            <div className="print-toolbar-row">
              <SelectField
                label={copy.toneLabel}
                value={selected.tone ?? 'BLACK'}
                disabled={off}
                onChange={(event) => onLineTone(event.target.value as PrintTone)}
              >
                <option value="BLACK">{copy.toneBlack}</option>
                <option value="GREY">{copy.toneGrey}</option>
              </SelectField>
            </div>
          ) : null}
          <div className="print-toolbar-row">
            <NumberField
              label={copy.leftLabel}
              value={selected.xMm}
              disabled={off}
              onChange={(xMm) => onGeometry({ xMm })}
            />
            <NumberField
              label={copy.topLabel}
              value={selected.yMm}
              disabled={off}
              onChange={(yMm) => onGeometry({ yMm })}
            />
            <NumberField
              label={copy.boxWidthLabel}
              value={selected.widthMm}
              disabled={off}
              onChange={(widthMm) => onGeometry({ widthMm })}
            />
            <NumberField
              label={copy.boxHeightLabel}
              value={selected.heightMm}
              disabled={off}
              onChange={(heightMm) => onGeometry({ heightMm })}
            />
          </div>
          <div className="print-toolbar-row">
            <IconButton label={copy.forward} disabled={off || editing} onClick={onForward}>
              <BringToFront aria-hidden="true" />
            </IconButton>
            <IconButton label={copy.backward} disabled={off || editing} onClick={onBackward}>
              <SendToBack aria-hidden="true" />
            </IconButton>
            <IconButton
              label={copy.duplicate}
              disabled={off || atMax || editing}
              onClick={onDuplicate}
            >
              <Copy aria-hidden="true" />
            </IconButton>
            <IconButton label={copy.remove} disabled={off || editing} onClick={onRemove}>
              <Trash2 aria-hidden="true" />
            </IconButton>
          </div>
        </>
      ) : (
        <p className="type-label text-muted-foreground">{copy.noSelection}</p>
      )}
    </div>
  );
}
