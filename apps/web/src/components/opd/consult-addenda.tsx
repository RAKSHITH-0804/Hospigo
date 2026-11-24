'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField, TextareaField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { addAddendum } from '@/lib/opd/clinical-client';
import { fill, formatDateTime } from '@/lib/opd/clinical-format';
import type { AddendumView } from '@/lib/opd/clinical-types';
import { opdErrorMessageFor } from '@/lib/opd/client';

const copy = staffCopy.opd.clinical.addenda;

/** Corrections of a completed note: the list (who, when, why) and, for the doctor, a form to add one. */
export function ConsultAddenda({
  visitId,
  addenda,
  canAdd,
  onChange,
  hideHeading = false,
}: {
  visitId: string;
  addenda: AddendumView[];
  canAdd: boolean;
  onChange: (addenda: AddendumView[]) => void;
  /** When the parent card already shows "Addenda". */
  hideHeading?: boolean;
}) {
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || text.trim() === '' || reason.trim() === '') {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await addAddendum(visitId, { text, reason });
    inFlight.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(opdErrorMessageFor(result.code));
      return;
    }
    onChange(result.data.addenda);
    setText('');
    setReason('');
  }

  return (
    <section className="flex flex-col gap-[var(--space-3)]" aria-label={copy.heading}>
      {hideHeading ? null : <h2 className="section-heading">{copy.heading}</h2>}
      {addenda.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-3)]">
          {addenda.map((a) => (
            <li key={a.id} className="flex flex-col gap-[var(--space-1)]">
              <p className="type-label whitespace-pre-wrap">{a.text}</p>
              <p className="type-small text-muted-foreground">
                {fill(copy.line, { who: a.addedBy.name, when: formatDateTime(a.createdAt) })} ·{' '}
                {fill(copy.reasonLine, { reason: a.reason })}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canAdd ? (
        <form onSubmit={submit} className="flex flex-col gap-[var(--space-2)]" noValidate>
          <p className="type-small text-muted-foreground">{copy.explain}</p>
          <TextareaField label={copy.text} value={text} onChange={(e) => setText(e.target.value)} />
          <InputField
            label={copy.reason}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              className="touch-target"
              disabled={busy || text.trim() === '' || reason.trim() === ''}
            >
              {busy ? copy.adding : copy.add}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
