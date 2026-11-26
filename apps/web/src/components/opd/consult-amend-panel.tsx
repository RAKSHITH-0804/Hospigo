'use client';

import { useRef, useState, type FormEvent } from 'react';
import { PrescriptionEditor } from '@/components/opd/prescription-editor';
import { Button } from '@/components/ui/button';
import { InputField, TextareaField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { amendConsultation } from '@/lib/opd/clinical-client';
import { fill, formatDateTime } from '@/lib/opd/clinical-format';
import type {
  ConsultationResponse,
  NoteVersionView,
  NoteView,
  PrescriptionRowView,
} from '@/lib/opd/clinical-types';
import { rxFromView, toRxPayload, type RxDraft } from '@/lib/opd/prescription-draft';
import type { MedicineSearchSettings } from '@/components/opd/prescription-editor';
import { opdErrorMessageFor } from '@/lib/opd/client';

const copy = staffCopy.opd.clinical.amend;

/**
 * The history of a completed note (who, when, why) and, for an Admin who may amend, the form that
 * saves a change as a new version. The API checks the permission, the reason and that something
 * really changed; the original text is never overwritten.
 */
export function ConsultAmendPanel({
  visitId,
  note,
  versions,
  canAmend,
  prescription,
  search,
  onAmended,
}: {
  visitId: string;
  note: NoteView;
  versions: NoteVersionView[];
  canAmend: boolean;
  /** The prescription as it is now (the form edits the whole list). */
  prescription: PrescriptionRowView[];
  search: MedicineSearchSettings;
  /** The note as it is after the change (the screen shows the latest version at once). */
  onAmended: (result: ConsultationResponse) => void;
}) {
  const [reason, setReason] = useState('');
  const [complaints, setComplaints] = useState(note.complaints ?? '');
  const [diagnosis, setDiagnosis] = useState(note.diagnosis ?? '');
  const [advice, setAdvice] = useState(note.advice ?? '');
  const [followUp, setFollowUp] = useState(note.followUpDate ?? '');
  const [rows, setRows] = useState<RxDraft[]>(() => rxFromView(prescription));
  const nextRowId = useRef(prescription.length + 2);
  const original = useRef(JSON.stringify(toRxPayload(rxFromView(prescription)).items));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    if (reason.trim() === '') {
      setMessage({ kind: 'error', text: copy.reasonRequired });
      return;
    }
    const payload = toRxPayload(rows);
    if (payload.incomplete > 0) {
      setMessage({ kind: 'error', text: copy.prescriptionIncomplete });
      return;
    }
    const prescriptionChanged = JSON.stringify(payload.items) !== original.current;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const result = await amendConsultation(visitId, {
      reason: reason.trim(),
      complaints,
      diagnosis,
      advice,
      followUpDate: followUp.trim(),
      ...(prescriptionChanged ? { prescription: payload.items } : {}),
    });
    inFlight.current = false;
    setBusy(false);
    if (!result.ok) {
      setMessage({
        kind: 'error',
        text:
          result.code === 'AMEND_NOTHING_CHANGED'
            ? copy.nothingChanged
            : result.code === 'AMEND_NEEDS_COMPLETED_NOTE'
              ? copy.needsCompleted
              : opdErrorMessageFor(result.code),
      });
      return;
    }
    setReason('');
    setMessage({ kind: 'ok', text: copy.saved });
    onAmended(result.data);
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {versions.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.none}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-2)]">
          {versions.map((v) => (
            <li key={v.versionNo} className="type-label">
              <span className="font-medium">
                {fill(copy.line, {
                  version: v.versionNo,
                  who: v.editedBy.name,
                  when: formatDateTime(v.at),
                })}
              </span>
              <br />
              <span className="text-muted-foreground">
                {fill(copy.reasonLine, { reason: v.reason })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canAmend ? (
        <form
          className="flex flex-col gap-[var(--space-2)]"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <h3 className="section-heading">{copy.formTitle}</h3>
          <p className="type-small text-muted-foreground">{copy.explain}</p>
          <TextareaField
            label={staffCopy.opd.clinical.consult.complaints}
            value={complaints}
            disabled={busy}
            onChange={(e) => setComplaints(e.target.value)}
          />
          <TextareaField
            label={staffCopy.opd.clinical.consult.diagnosis}
            value={diagnosis}
            disabled={busy}
            onChange={(e) => setDiagnosis(e.target.value)}
          />
          <TextareaField
            label={staffCopy.opd.clinical.consult.advice}
            value={advice}
            disabled={busy}
            onChange={(e) => setAdvice(e.target.value)}
          />
          <div className="flex flex-col gap-[var(--space-1)]">
            <h4 className="type-small font-medium">{copy.prescriptionHeading}</h4>
            <PrescriptionEditor
              rows={rows}
              onChange={setRows}
              nextId={() => nextRowId.current++}
              readOnly={busy}
              search={search}
              hideHeading
            />
          </div>
          <InputField
            label={copy.followUp}
            value={followUp}
            disabled={busy}
            onChange={(e) => setFollowUp(e.target.value)}
          />
          <TextareaField
            label={copy.reason}
            value={reason}
            required
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-[var(--space-3)]">
            <Button type="submit" className="touch-target" disabled={busy}>
              {busy ? copy.saving : copy.save}
            </Button>
            {message ? (
              <p
                role={message.kind === 'error' ? 'alert' : 'status'}
                className={message.kind === 'error' ? 'type-label text-destructive' : 'type-label'}
              >
                {message.text}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
