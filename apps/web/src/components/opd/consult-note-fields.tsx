import { DatePicker } from '@/components/ui/date-picker';
import { TextareaField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { EMPTY_VALUE, formatDateOnly } from '@/lib/patients/format';
import type { NoteDraft } from '@/lib/opd/note-draft';

const copy = staffCopy.opd.clinical.consult;

function ReadOnlyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <p className="type-label text-muted-foreground">{label}</p>
      <p className="type-label whitespace-pre-wrap">{value.trim() === '' ? EMPTY_VALUE : value}</p>
    </div>
  );
}

/** The four note fields: editable while the consultation runs, plain text afterwards. */
export function ConsultNoteFields({
  note,
  onChange,
  readOnly,
  calendar,
  receptionLine,
}: {
  note: NoteDraft;
  onChange: (patch: Partial<NoteDraft>) => void;
  readOnly: boolean;
  calendar: { weekStart: number; quickDays: readonly number[]; minDate: string };
  /** What reception wrote, as "<name>: <text>" (read-only), or null when nothing was entered. */
  receptionLine?: string | null;
}) {
  if (readOnly) {
    return (
      <div className="note-grid">
        {receptionLine ? <ReadOnlyBlock label={copy.complaints} value={receptionLine} /> : null}
        <ReadOnlyBlock label={copy.complaints} value={note.complaints} />
        <ReadOnlyBlock label={copy.diagnosis} value={note.diagnosis} />
        <ReadOnlyBlock label={copy.advice} value={note.advice} />
        <ReadOnlyBlock
          label={copy.followUpDate}
          value={note.followUpDate ? formatDateOnly(note.followUpDate) : ''}
        />
      </div>
    );
  }
  return (
    <div className="note-grid">
      {receptionLine ? (
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-label text-muted-foreground">{copy.complaints}</p>
          <p className="type-label whitespace-pre-wrap">{receptionLine}</p>
        </div>
      ) : null}
      <TextareaField
        label={copy.complaints}
        value={note.complaints}
        onChange={(e) => onChange({ complaints: e.target.value })}
      />
      <TextareaField
        label={copy.diagnosis}
        value={note.diagnosis}
        onChange={(e) => onChange({ diagnosis: e.target.value })}
      />
      <TextareaField
        label={copy.advice}
        value={note.advice}
        onChange={(e) => onChange({ advice: e.target.value })}
      />
      <DatePicker
        label={copy.followUpDate}
        value={note.followUpDate}
        min={calendar.minDate}
        weekStart={calendar.weekStart}
        quickDays={calendar.quickDays}
        onChange={(iso) => onChange({ followUpDate: iso })}
      />
    </div>
  );
}
