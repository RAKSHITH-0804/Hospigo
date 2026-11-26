'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConsultAddenda } from '@/components/opd/consult-addenda';
import { ConsultAmendPanel } from '@/components/opd/consult-amend-panel';
import { ConsultNoteFields } from '@/components/opd/consult-note-fields';
import {
  PrescriptionEditor,
  type MedicineSearchSettings,
} from '@/components/opd/prescription-editor';
import { TestsBox, type TestsSearchSettings } from '@/components/opd/tests-box';
import { VisitHeader } from '@/components/opd/visit-header';
import { VitalsSummary } from '@/components/opd/vitals-summary';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import {
  completeConsultation,
  saveNote,
  savePrescription,
  startConsultation,
  vitalsPath,
} from '@/lib/opd/clinical-client';
import { fill, formatClock } from '@/lib/opd/clinical-format';
import type {
  AddendumView,
  ClinicalVisit,
  ConsultationResponse,
  VitalsReadingView,
} from '@/lib/opd/clinical-types';
import { opdErrorMessageFor } from '@/lib/opd/client';
import { canCompleteNote, noteFromView, noteToBody, type NoteDraft } from '@/lib/opd/note-draft';
import { emptyRxRow, rxFromView, toRxPayload, type RxDraft } from '@/lib/opd/prescription-draft';
import {
  addChip,
  chipIds,
  chipsFromOrders,
  mergeServer,
  removeChip,
  testsKey,
  type TestChip,
} from '@/lib/opd/tests-draft';
import { saveTestOrders } from '@/lib/opd/tests-client';
import type { OrderView, TestItem } from '@/lib/opd/tests-types';
import { useAutosave, type SaveResult } from '@/lib/opd/use-autosave';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.clinical.consult;

export type ConsultSettings = MedicineSearchSettings & {
  autosaveSeconds: number;
  calendarWeekStart: number;
  followUpQuickDays: readonly number[];
  /** Tests box search settings; the box is shown only when these are given. */
  testsSearch?: TestsSearchSettings;
};

/**
 * The doctor's consultation screen. While the consultation runs (IN_CONSULTATION) the note and
 * the prescription are editable and are SAVED AUTOMATICALLY a few seconds after the last keystroke
 * (the doctor can still click "Save draft"). "Complete" waits for any save in progress, saves the
 * latest text, then completes; unfinished medicine rows block it (nothing is dropped silently).
 * A completed consultation is read-only; corrections are addenda. The API enforces all of it.
 */
export function ConsultScreen({
  initial,
  vitals,
  canWrite,
  canRecordVitals,
  canAmend = false,
  initialTests = [],
  canOrderTests = false,
  settings,
  backHref,
  children,
}: {
  initial: ConsultationResponse;
  vitals: VitalsReadingView[];
  canWrite: boolean;
  canRecordVitals: boolean;
  /** An Admin may change a completed note as a new version (permission opd.notes.amend). */
  canAmend?: boolean;
  /** The tests already ordered for this visit (doctors with the ordering permission). */
  initialTests?: OrderView[];
  canOrderTests?: boolean;
  settings: ConsultSettings;
  backHref: string;
  /** The server-rendered "previous visits" section. */
  children?: ReactNode;
}) {
  const [visit, setVisit] = useState<ClinicalVisit>(initial.visit);
  const [note, setNote] = useState<NoteDraft>(() => noteFromView(initial.consultation));
  // The prescription always starts with one empty line, ready for typing (empty lines are ignored).
  const [rows, setRows] = useState<RxDraft[]>(() => {
    const saved = rxFromView(initial.prescription);
    return saved.length > 0 ? saved : [emptyRxRow(1)];
  });
  const [addenda, setAddenda] = useState<AddendumView[]>(initial.addenda);
  const [versions, setVersions] = useState(initial.versions ?? []);
  const [noteView, setNoteView] = useState(initial.consultation);
  const [tests, setTests] = useState<TestChip[]>(() => chipsFromOrders(initialTests));
  const testsRef = useRef(tests);
  testsRef.current = tests;
  const [revision, setRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const startInFlight = useRef(false);
  const completeInFlight = useRef(false);
  const nextRowId = useRef(Math.max(initial.prescription.length + 1, 2));
  const savedNote = useRef(JSON.stringify(noteToBody(noteFromView(initial.consultation))));
  const savedRx = useRef(JSON.stringify(toRxPayload(rxFromView(initial.prescription)).items));
  const savedTests = useRef(testsKey(chipsFromOrders(initialTests)));

  const editable = canWrite && visit.status === 'IN_CONSULTATION';
  const completed = visit.status === 'COMPLETED';
  const { incomplete } = toRxPayload(rows);

  /** Sends only what differs from what the server already holds. */
  const saveAll = useCallback(async (): Promise<SaveResult> => {
    const noteBody = noteToBody(note);
    const noteJson = JSON.stringify(noteBody);
    if (noteJson !== savedNote.current) {
      const result = await saveNote(visit.id, noteBody);
      if (!result.ok) {
        return { ok: false, code: result.code };
      }
      savedNote.current = noteJson;
    }
    const { items } = toRxPayload(rows);
    const rxJson = JSON.stringify(items);
    if (rxJson !== savedRx.current) {
      const result = await savePrescription(visit.id, items);
      if (!result.ok) {
        return { ok: false, code: result.code };
      }
      savedRx.current = rxJson;
    }
    if (canOrderTests) {
      const current = testsRef.current;
      const testsJson = testsKey(current);
      if (testsJson !== savedTests.current) {
        const result = await saveTestOrders(visit.id, chipIds(current));
        if (!result.ok) {
          return { ok: false, code: result.code };
        }
        savedTests.current = testsJson;
        // Take over the server's statuses without undoing what was typed while this ran.
        setTests((now) => mergeServer(now, result.data.orders));
      }
    }
    return { ok: true };
  }, [note, rows, visit.id, canOrderTests]);

  const autosave = useAutosave({
    enabled: editable,
    delayMs: settings.autosaveSeconds * 1000,
    revision,
    save: saveAll,
  });

  // A doctor who closes the tab with unsaved typing is warned.
  const mustWarn = editable && (autosave.unsaved || autosave.state.phase === 'saving');
  useEffect(() => {
    if (!mustWarn) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mustWarn]);

  function changeNote(patch: Partial<NoteDraft>) {
    setNote((n) => ({ ...n, ...patch }));
    setRevision((r) => r + 1);
    setActionError(null);
  }

  function changeRows(next: RxDraft[]) {
    setRows(next);
    setRevision((r) => r + 1);
    setActionError(null);
  }

  function addTest(test: TestItem) {
    setTests((t) => addChip(t, test));
    setRevision((r) => r + 1);
    setActionError(null);
  }

  function removeTest(chargeItemId: string) {
    setTests((t) => removeChip(t, chargeItemId));
    setRevision((r) => r + 1);
    setActionError(null);
  }

  async function onStart() {
    if (startInFlight.current) {
      return;
    }
    startInFlight.current = true;
    setStarting(true);
    setActionError(null);
    const result = await startConsultation(visit.id);
    startInFlight.current = false;
    setStarting(false);
    if (!result.ok) {
      setActionError(opdErrorMessageFor(result.code));
      return;
    }
    setVisit(result.data.visit);
  }

  async function onComplete() {
    if (completeInFlight.current || !editable) {
      return;
    }
    setActionError(null);
    if (!canCompleteNote(note)) {
      setActionError(copy.needsText);
      return;
    }
    if (incomplete > 0) {
      setActionError(copy.incompleteRows);
      return;
    }
    completeInFlight.current = true;
    setCompleting(true);
    const saved = await autosave.flush();
    if (!saved) {
      completeInFlight.current = false;
      setCompleting(false);
      setActionError(copy.saveStatusError);
      return;
    }
    const result = await completeConsultation(visit.id);
    completeInFlight.current = false;
    setCompleting(false);
    if (!result.ok) {
      setActionError(opdErrorMessageFor(result.code));
      return;
    }
    setVisit(result.data.visit);
    setAddenda(result.data.addenda);
    setNoteView(result.data.consultation);
    setVersions(result.data.versions ?? []);
    setNote(noteFromView(result.data.consultation));
    setRows(rxFromView(result.data.prescription));
  }

  const status = autosave.state;
  const saveLine = !editable
    ? null
    : status.phase === 'saving'
      ? copy.saveStatusSaving
      : status.phase === 'error'
        ? copy.saveStatusError
        : autosave.unsaved
          ? copy.saveStatusUnsaved
          : status.phase === 'saved' && status.savedAt
            ? fill(copy.saveStatusSaved, { time: formatClock(status.savedAt) })
            : copy.saveStatusIdle;

  const showClinical = visit.status === 'IN_CONSULTATION' || completed;

  return (
    <div className="consult-page content-container-inner">
      <PageHeader title={copy.title} backHref={backHref} />
      <div className="consult-area-header">
        <VisitHeader visit={visit} />
      </div>

      {visit.status === 'WAITING' ? (
        <div className="consult-card flex flex-col gap-[var(--space-2)]">
          <p className="type-label text-muted-foreground">
            {canWrite ? copy.waitingNote : copy.notStartedReadOnly}
          </p>
          {canWrite ? (
            <div>
              <Button
                type="button"
                className="touch-target"
                disabled={starting}
                onClick={() => void onStart()}
              >
                {starting ? copy.starting : copy.start}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="consult-grid">
        <section className="consult-card consult-area-vitals" aria-label={copy.vitalsHeading}>
          <VitalsSummary
            readings={vitals}
            editHref={canRecordVitals ? vitalsPath(visit.id) : undefined}
          />
        </section>

        {showClinical ? (
          <>
            <section
              className="consult-card consult-card-fill consult-area-note"
              aria-label={copy.notesHeading}
            >
              <h2 className="section-heading">{copy.notesHeading}</h2>
              {completed ? (
                <>
                  <p role="status" className="type-label text-muted-foreground">
                    {copy.completedBanner}
                  </p>
                  <div className="flex flex-wrap gap-[var(--space-2)]">
                    <Link
                      href={`/app/opd/visits/${encodeURIComponent(visit.id)}/prescription`}
                      className={cn(buttonVariants({ variant: 'outline' }), 'touch-target w-fit')}
                    >
                      {staffCopy.print.prescription.print}
                    </Link>
                    <Link
                      href={`/app/opd/visits/${encodeURIComponent(visit.id)}/report`}
                      className={cn(buttonVariants({ variant: 'outline' }), 'touch-target w-fit')}
                    >
                      {staffCopy.print.patientReport.print}
                    </Link>
                  </div>
                </>
              ) : null}
              {!canWrite && !completed ? (
                <p className="type-label text-muted-foreground">{copy.readOnlyNote}</p>
              ) : null}
              <ConsultNoteFields
                note={note}
                onChange={changeNote}
                readOnly={!editable}
                receptionLine={
                  visit.receptionSymptoms
                    ? staffCopy.opd.symptoms.line
                        .replace('{name}', visit.receptionistName ?? '')
                        .replace('{text}', visit.receptionSymptoms)
                    : null
                }
                calendar={{
                  weekStart: settings.calendarWeekStart,
                  quickDays: settings.followUpQuickDays,
                  minDate: visit.visitDate,
                }}
              />
            </section>

            <section
              className="consult-card consult-card-fill consult-area-rx"
              aria-label={staffCopy.opd.clinical.rx.heading}
            >
              <h2 className="section-heading">{staffCopy.opd.clinical.rx.heading}</h2>
              <PrescriptionEditor
                rows={rows}
                onChange={changeRows}
                nextId={() => nextRowId.current++}
                readOnly={!editable}
                search={settings}
                hideHeading
              />
              {settings.testsSearch && (canOrderTests || tests.length > 0) ? (
                <TestsBox
                  chips={tests}
                  onAdd={addTest}
                  onRemove={removeTest}
                  readOnly={!editable || !canOrderTests}
                  search={settings.testsSearch}
                />
              ) : null}
              {editable && incomplete > 0 ? (
                <p role="status" className="type-small text-destructive">
                  {fill(copy.incompleteRowsHint, { count: incomplete })}
                </p>
              ) : null}
            </section>

            {completed ? (
              <section
                className="consult-card consult-area-addenda"
                aria-label={staffCopy.opd.clinical.addenda.heading}
              >
                <h2 className="section-heading">{staffCopy.opd.clinical.addenda.heading}</h2>
                <ConsultAddenda
                  visitId={visit.id}
                  addenda={addenda}
                  canAdd={false}
                  onChange={setAddenda}
                  hideHeading
                />
              </section>
            ) : null}

            {completed && noteView ? (
              <section
                className="consult-card consult-area-addenda"
                aria-label={staffCopy.opd.clinical.amend.heading}
              >
                <h2 className="section-heading">
                  {staffCopy.opd.clinical.amend.heading}
                  {noteView?.amended
                    ? ` · ${fill(staffCopy.opd.clinical.amend.amendedMark, { version: noteView.currentVersion ?? 0 })}`
                    : ''}
                </h2>
                <ConsultAmendPanel
                  visitId={visit.id}
                  key={noteView.currentVersion ?? 0}
                  note={noteView}
                  versions={versions}
                  canAmend={canAmend}
                  onAmended={(result) => {
                    setNoteView(result.consultation);
                    setVersions(result.versions ?? []);
                    setNote(noteFromView(result.consultation));
                    setRows(rxFromView(result.prescription));
                  }}
                />
              </section>
            ) : null}
          </>
        ) : null}

        <div className="consult-area-actions consult-actions-block">
          {actionError ? (
            <p role="alert" className="type-label text-destructive">
              {actionError}
            </p>
          ) : null}

          {editable && !initial.doctorDetails.registrationNo ? (
            <p role="note" className="settings-reminder type-label">
              {staffCopy.doctorProfile.consultReminder}{' '}
              <Link href="/app/profile" className="underline">
                {staffCopy.doctorProfile.consultReminderLink}
              </Link>
            </p>
          ) : null}

          {editable ? (
            <div className="consult-actions">
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                disabled={completing || status.phase === 'saving'}
                onClick={() => void autosave.saveNow()}
              >
                {copy.saveDraft}
              </Button>
              <Button
                type="button"
                className="touch-target"
                disabled={completing}
                onClick={() => void onComplete()}
              >
                {completing ? copy.completing : copy.complete}
              </Button>
              <p role="status" className="type-small text-muted-foreground">
                {saveLine}
              </p>
            </div>
          ) : null}
        </div>

        <div className="consult-area-footer consult-footer">
          <div className="consult-footer-previous">{children}</div>
          <Link
            href={backHref}
            className={cn(buttonVariants({ variant: 'outline' }), 'touch-target shrink-0')}
          >
            {copy.backToQueue}
          </Link>
        </div>
      </div>
    </div>
  );
}
