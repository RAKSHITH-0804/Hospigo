'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { NumberField } from '@/components/print/number-field';
import { PrintCanvas } from '@/components/print/print-canvas';
import { PrintSheet } from '@/components/print/print-sheet';
import { PrintToolbar, type RibbonStyle } from '@/components/print/print-toolbar';
import {
  insertValue,
  setParagraphAlign,
  setRunStyle,
  styleAtCursor,
  toggleRunMark,
} from '@/components/print/rich-editor';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { printDesignerConfig as C } from '@/config/print';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { errorMessageFor } from '@/lib/patients/client';
import { resetPrintTemplate, savePrintTemplate } from '@/lib/print/client';
import {
  duplicateBox,
  moveInOrder,
  newFieldBox,
  newLineBox,
  newLogoBox,
  newTextBox,
  removeBox,
  removeField,
  replaceBox,
} from '@/lib/print/elements';
import {
  DOC_FIELD_ORDER,
  fromPreset,
  invalidMessage,
  paperNeedsSize,
  previewTemplate,
  sampleItems,
  toInput,
  toPayload,
} from '@/lib/print/form';
import { clampBox, type Page } from '@/lib/print/geometry';
import {
  alignAll,
  appendField,
  commonAlign,
  commonStyle,
  fieldsOnPage,
  styleAll,
  toggleAll,
} from '@/lib/print/rich';
import { parseZoom, ZOOM_FIT_PAGE, ZOOM_FIT_WIDTH, type ZoomChoice } from '@/lib/print/zoom';
import {
  canRedo,
  canUndo,
  commit,
  redo,
  startHistory,
  undo,
  type History,
} from '@/lib/print/history';
import {
  PRINT_DOC_TYPES,
  PRINT_PAPERS,
  type PrintDocType,
  type PrintContent,
  type PrintElement,
  type PrintFont,
  type PrintTone,
  type PrintAlign,
  type PrintPaper,
  type PrintPreset,
  type PrintTemplate,
  type PrintTemplateInput,
} from '@/lib/print/types';

const copy = staffCopy.settings.printing;

type Histories = Record<string, History<PrintTemplateInput>>;
const GEOMETRY_KEYS = ['xMm', 'yMm', 'widthMm', 'heightMm'] as const;

/**
 * The Admin's print designer (registration slip, receipt, prescription), one document at a time: a
 * page that works like a page in a word processor (boxes to drag, resize and style) with the page
 * settings and the list of values beside it, a Print preview, Save and "go back to the default". The
 * API checks every value and the permission; this screen only keeps people from sending junk.
 */
export function PrintingSettings({
  templates,
  presets,
  canWrite,
  hospitalName,
}: {
  templates: PrintTemplate[];
  presets: PrintPreset[];
  canWrite: boolean;
  hospitalName: string;
}) {
  const [saved, setSaved] = useState<Record<string, PrintTemplate>>(() =>
    Object.fromEntries(templates.map((t) => [t.docType, t])),
  );
  const docs = PRINT_DOC_TYPES.filter((d) => saved[d]);
  const [docType, setDocType] = useState<PrintDocType>(docs[0] ?? 'RECEIPT');
  const [histories, setHistories] = useState<Histories>(() =>
    Object.fromEntries(templates.map((t) => [t.docType, startHistory(toInput(t))])),
  );
  /** The boxes while a drag is going on (shown, but not a step yet). */
  const [draft, setDraft] = useState<PrintElement[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomChoice>(ZOOM_FIT_PAGE);
  const [snapMm, setSnapMm] = useState<number>(C.snapDefaultMm);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inFlight = useRef(false);
  /** The box whose text is being typed in, and the editor doing it (for the ribbon). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, redraw] = useState(0);
  /** The steps as they were when typing in a box began: typing is ONE step, however long. */
  const editBase = useRef<History<PrintTemplateInput> | null>(null);
  const editingRef = useRef<string | null>(null);
  editingRef.current = editingId;
  // The ribbon follows the cursor: draw again at every change of the editor.
  useEffect(() => {
    if (!editor) {
      return;
    }
    const again = () => redraw((n) => n + 1);
    editor.on('transaction', again);
    return () => {
      editor.off('transaction', again);
    };
  }, [editor]);

  const current = saved[docType];
  const history = histories[docType];
  const form = history?.present;
  const fieldKeys = current ? [...DOC_FIELD_ORDER[current.docType]] : [];
  if (!current || !history || !form) {
    return null;
  }

  const shownForm: PrintTemplateInput = draft
    ? { ...form, layout: { ...form.layout, elements: draft } }
    : form;
  const template = previewTemplate(docType, shownForm);
  const page: Page | null = template
    ? { widthMm: template.pageWidthMm, heightMm: template.pageHeightMm }
    : null;
  const elements = shownForm.layout.elements;
  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const items = sampleItems(fieldKeys, hospitalName);
  const onPage = fieldsOnPage(form.layout.elements);
  const atMax = form.layout.elements.length >= C.maxElements;
  const readOnly = !canWrite || busy !== null;

  function setHistory(next: History<PrintTemplateInput>) {
    setHistories((all) => ({ ...all, [docType]: next }));
  }

  function startEditing(id: string) {
    if (readOnly) {
      return;
    }
    editBase.current = history!;
    setSelectedId(id);
    setEditingId(id);
  }

  function stopEditing() {
    editBase.current = null;
    setEditingId(null);
    setEditor(null);
  }

  /** Selecting another box ends the typing in this one. */
  function select(id: string | null) {
    if (editingRef.current && id !== editingRef.current) {
      stopEditing();
    }
    setSelectedId(id);
  }

  /**
   * The text of the box being typed in changed. The whole typing session is ONE step on the steps
   * as they were when it began, so Undo takes back everything typed in that box at once.
   */
  function typed(content: PrintContent) {
    const id = editingRef.current;
    const base = editBase.current;
    if (!id || !base) {
      return;
    }
    const next: PrintTemplateInput = {
      ...base.present,
      layout: {
        ...base.present.layout,
        elements: replaceBox(base.present.layout.elements, id, { content }),
      },
    };
    setHistories((all) => ({ ...all, [docType]: commit(base, next, C.historyLimit) }));
    setMessage(null);
  }

  /** One step: the whole form after a change. */
  function change(next: PrintTemplateInput) {
    const stepped = commit(history!, next, C.historyLimit);
    // a change made while typing (a place, a colour) becomes the base the typing continues from
    if (editingRef.current) {
      editBase.current = stepped;
    }
    setHistory(stepped);
    setDraft(null);
    setMessage(null);
    setConfirmReset(false);
  }

  /** A page setting changed: the starting point is now "custom". */
  function changePage(update: (f: PrintTemplateInput) => PrintTemplateInput) {
    change({ ...update(form!), preset: null });
  }

  function changeElements(next: PrintElement[]) {
    change({ ...form!, layout: { ...form!.layout, elements: next } });
  }

  /** A change from the toolbar: a size or place is kept on the page. */
  function changeSelected(partial: Partial<PrintElement>) {
    if (!selected || !page) {
      return;
    }
    let next = { ...selected, ...partial };
    if (GEOMETRY_KEYS.some((k) => k in partial)) {
      const min = selected.type === 'LINE' ? C.minLineMm : C.minBoxMm;
      next = { ...next, ...clampBox(next, page, min, min) };
    }
    changeElements(replaceBox(form!.layout.elements, selected.id, next));
  }

  function add(make: (all: PrintElement[], p: Page) => PrintElement) {
    if (!page || atMax) {
      return;
    }
    const box = make(form!.layout.elements, page);
    changeElements([...form!.layout.elements, box]);
    select(box.id);
  }

  function toggleField(key: string, on: boolean) {
    if (!page) {
      return;
    }
    stopEditing();
    if (!on) {
      changeElements(removeField(form!.layout.elements, key));
      return;
    }
    if (atMax) {
      return;
    }
    const box = newFieldBox(
      form!.layout.elements,
      page,
      key,
      form!.layout.fontSizePt,
      form!.mode === 'FULL',
    );
    changeElements([...form!.layout.elements, box]);
    setSelectedId(box.id);
  }

  function pickPreset(key: string) {
    const preset = presets.find((p) => p.key === key);
    stopEditing();
    if (preset) {
      change(fromPreset(preset, docType));
      setSelectedId(null);
      setMessage({ kind: 'ok', text: copy.presetApplied });
    } else {
      changePage((f) => f);
    }
  }

  const typing = editingId !== null && editor !== null && editingId === selectedId;
  const richSelected = selected?.type === 'RICH' && selected.content ? selected : null;
  const ribbonStyle: RibbonStyle = typing
    ? styleAtCursor(editor!)
    : richSelected
      ? { ...commonStyle(richSelected.content), align: commonAlign(richSelected.content) }
      : {};
  const labels = staffCopy.print.fields as Record<string, string>;
  const valueChoices = fieldKeys.map((key) => ({ key, label: labels[key] ?? key }));
  /** Changes all the text of the selected box (when it is not being typed in). */
  const editAll = (change: (content: PrintContent) => PrintContent) => {
    if (richSelected?.content) {
      changeSelected({ content: change(richSelected.content) });
    }
  };

  async function save() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy('save');
    setMessage(null);
    const result = await savePrintTemplate(docType, toPayload(form!));
    inFlight.current = false;
    setBusy(null);
    if (result.ok) {
      setSaved((all) => ({ ...all, [docType]: result.data }));
      setHistory(startHistory(toInput(result.data)));
      setDraft(null);
      setMessage({ kind: 'ok', text: copy.saved });
    } else {
      setMessage({
        kind: 'error',
        text:
          result.code === 'PRINT_TEMPLATE_INVALID'
            ? invalidMessage(result)
            : errorMessageFor(result.code),
      });
    }
  }

  async function reset() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy('reset');
    setMessage(null);
    const result = await resetPrintTemplate(docType);
    inFlight.current = false;
    setBusy(null);
    setConfirmReset(false);
    if (result.ok) {
      setSaved((all) => ({ ...all, [docType]: result.data }));
      setHistory(startHistory(toInput(result.data)));
      setDraft(null);
      setSelectedId(null);
      setMessage({ kind: 'ok', text: copy.resetDone });
    } else {
      setMessage({ kind: 'error', text: errorMessageFor(result.code) });
    }
  }

  return (
    <div className="printing-settings">
      <div className="printing-docs" role="group" aria-label={copy.docsAria}>
        {docs.map((d) => (
          <Button
            key={d}
            type="button"
            variant={d === docType ? 'default' : 'outline'}
            aria-pressed={d === docType}
            className="touch-target"
            onClick={() => {
              stopEditing();
              setDocType(d);
              setSelectedId(null);
              setDraft(null);
              setMessage(null);
              setConfirmReset(false);
            }}
          >
            {staffCopy.print.docs[d]}
          </Button>
        ))}
      </div>

      <p className="type-label text-muted-foreground">
        {current.source === 'CUSTOM' ? copy.sourceCustom : copy.sourceDefault}
      </p>
      {canWrite ? null : <p className="type-label text-muted-foreground">{copy.readOnly}</p>}

      <div className="printing-designer">
        <fieldset disabled={readOnly} className="printing-form printing-side">
          <h3 className="section-heading">{copy.pageHeading}</h3>
          <SelectField
            label={copy.presetLabel}
            value={form.preset ?? ''}
            onChange={(event) => pickPreset(event.target.value)}
          >
            <option value="">{copy.presetCustom}</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </SelectField>

          <label className="printing-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => changePage((f) => ({ ...f, enabled: event.target.checked }))}
            />
            <span>
              <span className="type-label-strong">{copy.enabledLabel}</span>
              <span className="type-small block text-muted-foreground">{copy.enabledHint}</span>
            </span>
          </label>

          <SelectField
            label={copy.paperLabel}
            value={form.paper}
            onChange={(event) => {
              const paper = event.target.value as PrintPaper;
              changePage((f) => ({
                ...f,
                paper,
                widthMm: paperNeedsSize(paper) ? (f.widthMm ?? 100) : null,
                heightMm: paperNeedsSize(paper) ? (f.heightMm ?? 50) : null,
              }));
            }}
          >
            {PRINT_PAPERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectField>
          {paperNeedsSize(form.paper) ? (
            <div className="printing-grid">
              <NumberField
                label={copy.widthLabel}
                value={form.widthMm}
                keepUnreadable
                onChange={(widthMm) => changePage((f) => ({ ...f, widthMm }))}
              />
              <NumberField
                label={copy.heightLabel}
                value={form.heightMm}
                keepUnreadable
                onChange={(heightMm) => changePage((f) => ({ ...f, heightMm }))}
              />
            </div>
          ) : (
            <SelectField
              label={copy.orientationLabel}
              value={form.orientation}
              onChange={(event) =>
                changePage((f) => ({
                  ...f,
                  orientation: event.target.value === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT',
                }))
              }
            >
              <option value="PORTRAIT">{copy.portrait}</option>
              <option value="LANDSCAPE">{copy.landscape}</option>
            </SelectField>
          )}
          <SelectField
            label={copy.modeLabel}
            value={form.mode}
            onChange={(event) =>
              changePage((f) => ({
                ...f,
                mode: event.target.value === 'PREPRINTED' ? 'PREPRINTED' : 'FULL',
              }))
            }
          >
            <option value="FULL">{copy.modeFull}</option>
            <option value="PREPRINTED">{copy.modePreprinted}</option>
          </SelectField>
          <NumberField
            label={copy.fontLabel}
            value={form.layout.fontSizePt}
            keepUnreadable
            onChange={(fontSizePt) =>
              changePage((f) => ({ ...f, layout: { ...f.layout, fontSizePt } }))
            }
          />

          <h3 className="section-heading">{copy.marginsHeading}</h3>
          <div className="printing-grid">
            {(
              [
                ['topMm', copy.marginTop],
                ['rightMm', copy.marginRight],
                ['bottomMm', copy.marginBottom],
                ['leftMm', copy.marginLeft],
              ] as const
            ).map(([name, label]) => (
              <NumberField
                key={name}
                label={label}
                value={form.margins[name]}
                keepUnreadable
                onChange={(value) =>
                  changePage((f) => ({ ...f, margins: { ...f.margins, [name]: value } }))
                }
              />
            ))}
          </div>

          <h3 className="section-heading">{copy.offsetHeading}</h3>
          <div className="printing-grid">
            <NumberField
              label={copy.offsetX}
              value={form.layout.offset.xMm}
              keepUnreadable
              onChange={(xMm) =>
                changePage((f) => ({
                  ...f,
                  layout: { ...f.layout, offset: { ...f.layout.offset, xMm } },
                }))
              }
            />
            <NumberField
              label={copy.offsetY}
              value={form.layout.offset.yMm}
              keepUnreadable
              onChange={(yMm) =>
                changePage((f) => ({
                  ...f,
                  layout: { ...f.layout, offset: { ...f.layout.offset, yMm } },
                }))
              }
            />
          </div>

          <h3 className="section-heading">{copy.fieldsHeading}</h3>
          <p className="type-small text-muted-foreground">{copy.fieldsHint}</p>
          <div className="printing-fields">
            {fieldKeys.map((key) => (
              <label key={key} className="printing-check">
                <input
                  type="checkbox"
                  checked={onPage.has(key)}
                  onChange={(event) => toggleField(key, event.target.checked)}
                />
                <span>{staffCopy.print.fields[key] ?? key}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="printing-main">
          <div className="printing-view-bar">
            <div role="group" aria-label={copy.modeEdit} className="printing-docs">
              <Button
                type="button"
                variant={view === 'edit' ? 'default' : 'outline'}
                aria-pressed={view === 'edit'}
                onClick={() => {
                  stopEditing();
                  setView('edit');
                }}
              >
                {copy.modeEdit}
              </Button>
              <Button
                type="button"
                variant={view === 'preview' ? 'default' : 'outline'}
                aria-pressed={view === 'preview'}
                onClick={() => {
                  stopEditing();
                  setView('preview');
                }}
              >
                {copy.modePreview}
              </Button>
            </div>
            <SelectField
              label={copy.zoomLabel}
              value={String(zoom)}
              onChange={(event) => setZoom(parseZoom(event.target.value))}
            >
              <option value={ZOOM_FIT_PAGE}>{copy.zoomFitPage}</option>
              <option value={ZOOM_FIT_WIDTH}>{copy.zoomFitWidth}</option>
              {C.zoomOptionsPct.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </SelectField>
            <SelectField
              label={copy.snapLabel}
              value={String(snapMm)}
              onChange={(event) => setSnapMm(Number(event.target.value))}
            >
              {C.snapOptionsMm.map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? copy.snapOff : fill(copy.snapMm, { mm: s })}
                </option>
              ))}
            </SelectField>
          </div>

          {view === 'edit' ? (
            <>
              <PrintToolbar
                selected={selected}
                editing={typing}
                readOnly={readOnly}
                full={form.mode === 'FULL'}
                canUndo={canUndo(history)}
                canRedo={canRedo(history)}
                atMax={atMax}
                defaultPt={form.layout.fontSizePt}
                style={ribbonStyle}
                valueChoices={valueChoices}
                onSize={(size) =>
                  typing ? setRunStyle(editor!, { size }) : editAll((c) => styleAll(c, { size }))
                }
                onToggle={(mark) =>
                  typing ? toggleRunMark(editor!, mark) : editAll((c) => toggleAll(c, mark))
                }
                onFont={(font: PrintFont) =>
                  typing
                    ? setRunStyle(editor!, { font: font === 'SANS' ? null : font })
                    : editAll((c) => styleAll(c, { font }))
                }
                onTone={(tone: PrintTone) =>
                  typing
                    ? setRunStyle(editor!, { tone: tone === 'BLACK' ? null : tone })
                    : editAll((c) => styleAll(c, { tone }))
                }
                onAlign={(align: PrintAlign) =>
                  typing ? setParagraphAlign(editor!, align) : editAll((c) => alignAll(c, align))
                }
                onInsertValue={(field) =>
                  typing ? insertValue(editor!, field) : editAll((c) => appendField(c, field))
                }
                onEditText={() => selected && startEditing(selected.id)}
                onGeometry={changeSelected}
                onLineTone={(tone) => changeSelected({ tone })}
                onAddText={() => {
                  stopEditing();
                  add((all, p) => newTextBox(all, p, copy.textDefault, form.layout.fontSizePt));
                }}
                onAddLine={() => {
                  stopEditing();
                  add((all, p) => newLineBox(all, p));
                }}
                onAddLogo={() => {
                  stopEditing();
                  add((all, p) => newLogoBox(all, p));
                }}
                onDuplicate={() =>
                  selected && page && add((all, p) => duplicateBox(all, selected, p))
                }
                onRemove={() => {
                  if (selected) {
                    changeElements(removeBox(form.layout.elements, selected.id));
                    setSelectedId(null);
                  }
                }}
                onForward={() =>
                  selected && changeElements(moveInOrder(form.layout.elements, selected.id, 1))
                }
                onBackward={() =>
                  selected && changeElements(moveInOrder(form.layout.elements, selected.id, -1))
                }
                onUndo={() => setHistory(undo(history))}
                onRedo={() => setHistory(redo(history))}
              />
              {form.mode === 'PREPRINTED' ? (
                <p className="type-small text-muted-foreground">{copy.ghostNote}</p>
              ) : null}
              {template ? (
                <PrintCanvas
                  template={template}
                  items={items}
                  selectedId={selectedId}
                  zoom={zoom}
                  snapMm={snapMm}
                  readOnly={readOnly}
                  onSelect={select}
                  onDraft={setDraft}
                  onCommit={changeElements}
                  onRemove={(id) => {
                    changeElements(removeBox(form.layout.elements, id));
                    setSelectedId(null);
                  }}
                  onDuplicate={(id) => {
                    const source = form.layout.elements.find((e) => e.id === id);
                    if (source && page) {
                      add((all, p) => duplicateBox(all, source, p));
                    }
                  }}
                  onUndo={() => setHistory(undo(history))}
                  onRedo={() => setHistory(redo(history))}
                  editingId={editingId}
                  onEdit={startEditing}
                  onEditorReady={setEditor}
                  onEditorChange={typed}
                  onStopEditing={stopEditing}
                  labels={labels}
                />
              ) : null}
            </>
          ) : template ? (
            <section aria-label={copy.modePreview} className="printing-preview">
              <p className="type-label text-muted-foreground">{copy.previewNote}</p>
              <div className="print-paper-wrap">
                <PrintSheet template={template} items={items} />
              </div>
            </section>
          ) : null}

          <div className="printing-actions">
            <Button
              type="button"
              className="touch-target"
              disabled={!canWrite || busy !== null}
              onClick={save}
            >
              {busy === 'save' ? copy.saving : copy.save}
            </Button>
            {canWrite && current.source === 'CUSTOM' && !confirmReset ? (
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                disabled={busy !== null}
                onClick={() => setConfirmReset(true)}
              >
                {copy.reset}
              </Button>
            ) : null}
            {confirmReset ? (
              <>
                <span className="type-label">{copy.resetConfirm}</span>
                <Button
                  type="button"
                  variant="destructive"
                  className="touch-target"
                  onClick={reset}
                >
                  {busy === 'reset' ? copy.resetting : copy.resetYes}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="touch-target"
                  onClick={() => setConfirmReset(false)}
                >
                  {copy.cancel}
                </Button>
              </>
            ) : null}
          </div>

          {message ? (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={
                message.kind === 'error'
                  ? 'type-label text-destructive'
                  : 'type-label text-muted-foreground'
              }
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
