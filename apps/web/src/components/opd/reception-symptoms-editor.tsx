'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextareaField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { saveReceptionSymptoms } from '@/lib/opd/client';
import { errorMessageFor } from '@/lib/patients/client';

const copy = staffCopy.opd.symptoms;

/**
 * Reception can add or change the symptoms of a visit until the doctor starts the consultation. The
 * API (and the database) refuse a change after that; this box only keeps the person from trying.
 */
export function ReceptionSymptomsEditor({
  visitId,
  initial,
}: {
  visitId: string;
  initial: string | null;
}) {
  const [text, setText] = useState(initial ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const result = await saveReceptionSymptoms(visitId, text);
    setSaving(false);
    if (result.ok) {
      setText(result.data.receptionSymptoms ?? '');
      setMessage({ kind: 'ok', text: copy.saved });
      return;
    }
    setMessage({
      kind: 'error',
      text: result.code === 'CONSULTATION_STARTED' ? copy.started : errorMessageFor(result.code),
    });
  }

  return (
    <section className="no-print flex flex-col gap-[var(--space-2)]">
      <TextareaField
        label={copy.label}
        hint={copy.hint}
        placeholder={copy.placeholder}
        maxLength={copy.maxLength}
        value={text}
        disabled={saving}
        onChange={(event) => {
          setText(event.target.value);
          setMessage(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <Button
          type="button"
          variant="outline"
          className="touch-target"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? copy.saving : copy.save}
        </Button>
        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={
              message.kind === 'error'
                ? 'type-label text-destructive'
                : 'type-label text-foreground'
            }
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
