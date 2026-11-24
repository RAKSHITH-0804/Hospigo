'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { searchMedicines } from '@/lib/opd/clinical-client';
import { fill } from '@/lib/opd/clinical-format';
import type { MedicineHit } from '@/lib/opd/clinical-types';
import { emptyRxRow, rxMissing, rxRowState, type RxDraft } from '@/lib/opd/prescription-draft';
import { ABORTED_CODE } from '@/lib/patients/client';

const copy = staffCopy.opd.clinical.rx;

export type MedicineSearchSettings = { minChars: number; debounceMs: number; limit: number };

type PickerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; hits: MedicineHit[] };

type MissingKey =
  | 'missingMedicineListed'
  | 'missingMedicineFree'
  | 'missingDose'
  | 'missingFrequency'
  | 'missingDuration';

const medicineInputId = (rowId: number) => `rx-${rowId}-medicine`;
const doseInputId = (rowId: number) => `rx-${rowId}-dose`;

/** Search box for the hospital's medicine list (waits a moment after typing, cancels old searches). */
function MedicinePicker({
  id,
  label,
  settings,
  query,
  onQuery,
  onPick,
  onUseTyped,
}: {
  id: string;
  label: string;
  settings: MedicineSearchSettings;
  query: string;
  onQuery: (text: string) => void;
  onPick: (hit: MedicineHit) => void;
  onUseTyped: (text: string) => void;
}) {
  const [state, setState] = useState<PickerState>({ status: 'idle' });

  useEffect(() => {
    const text = query.trim();
    if (text.length < settings.minChars) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      void searchMedicines(text, settings.limit, controller.signal).then((result) => {
        if (controller.signal.aborted || (!result.ok && result.code === ABORTED_CODE)) {
          return;
        }
        setState(result.ok ? { status: 'ready', hits: result.data.items } : { status: 'error' });
      });
    }, settings.debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, settings.minChars, settings.debounceMs, settings.limit]);

  return (
    <div className="relative">
      <InputField
        id={id}
        hideLabel
        label={label}
        placeholder={copy.searchPlaceholder}
        autoComplete="off"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {query.trim() !== '' ? (
        <button
          type="button"
          className="type-small w-fit text-primary underline"
          onClick={() => onUseTyped(query.trim())}
        >
          {fill(copy.useTyped, { text: query.trim() })}
        </button>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert" className="type-small text-destructive">
          {copy.searchError}
        </p>
      ) : null}
      {state.status === 'ready' && state.hits.length === 0 ? (
        <p className="type-small text-muted-foreground">{copy.searchNone}</p>
      ) : null}
      {state.status === 'ready' && state.hits.length > 0 ? (
        <ul className="rx-hits" aria-label={label}>
          {state.hits.map((hit) => (
            <li key={hit.id}>
              <Button type="button" variant="outline" onClick={() => onPick(hit)}>
                {hit.name}
                {hit.form ? ` · ${hit.form}` : ''}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One line of a finished prescription (read-only view), with every part named. */
function ReadOnlyRow({ row }: { row: RxDraft }) {
  return (
    <li className="flex flex-col gap-[var(--space-1)]">
      <p className="type-label-strong">
        {row.medicineName}{' '}
        {row.mode === 'FREE' ? <Badge variant="neutral">{copy.unlisted}</Badge> : null}
      </p>
      <p className="type-label text-muted-foreground">
        {fill(copy.readLine, { dose: row.dose, frequency: row.frequency, duration: row.duration })}
        {row.instructions ? ` · ${row.instructions}` : ''}
      </p>
    </li>
  );
}

/**
 * The prescription box: ONE LINE per medicine (medicine, dose, frequency, duration, instructions
 * and a remove button) with "Add medicine" right under the lines. The medicine is picked from the
 * hospital list (search) or typed (flagged "unlisted"). Enter in the last line's Instructions box
 * starts the next line; a blank line is ignored; every line can be removed. The parent keeps the
 * rows so they can be saved automatically; unfinished lines stay on screen and are not saved
 * until they are finished.
 */
export function PrescriptionEditor({
  rows,
  onChange,
  nextId,
  readOnly,
  search,
  hideHeading = false,
}: {
  rows: RxDraft[];
  onChange: (rows: RxDraft[]) => void;
  nextId: () => number;
  readOnly: boolean;
  search: MedicineSearchSettings;
  /** When the parent card already shows "Prescription". */
  hideHeading?: boolean;
}) {
  const [focusRow, setFocusRow] = useState<number | null>(null);

  // After adding a line, the cursor goes to its first box.
  useEffect(() => {
    if (focusRow === null) {
      return;
    }
    const target =
      document.getElementById(medicineInputId(focusRow)) ??
      document.getElementById(doseInputId(focusRow));
    target?.focus();
    setFocusRow(null);
  }, [focusRow, rows.length]);

  function update(id: number, patch: Partial<RxDraft>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const last = rows[rows.length - 1];
    if (last && rxRowState(last) === 'blank') {
      // A blank line is already waiting: use it instead of piling up empty lines.
      setFocusRow(last.id);
      return;
    }
    const id = nextId();
    onChange([...rows, emptyRxRow(id)]);
    setFocusRow(id);
  }

  if (readOnly) {
    const shown = rows.filter((r) => rxRowState(r) === 'complete');
    return (
      <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.heading}>
        {hideHeading ? null : <h2 className="section-heading">{copy.heading}</h2>}
        {shown.length === 0 ? (
          <p className="type-label text-muted-foreground">{copy.readOnlyEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-[var(--space-3)]">
            {shown.map((row) => (
              <ReadOnlyRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.heading}>
      {hideHeading ? null : <h2 className="section-heading">{copy.heading}</h2>}
      {rows.length === 0 ? <p className="type-label text-muted-foreground">{copy.empty}</p> : null}
      {rows.length > 0 ? (
        <div className="rx-head type-small text-muted-foreground" aria-hidden="true">
          <span>{copy.colMedicine}</span>
          <span>{copy.dose}</span>
          <span>{copy.frequency}</span>
          <span>{copy.duration}</span>
          <span>{copy.instructions}</span>
          <span />
        </div>
      ) : null}
      {rows.map((row, index) => {
        const n = index + 1;
        const title = fill(copy.rowTitle, { n });
        const isLast = index === rows.length - 1;
        return (
          <div
            key={row.id}
            role="group"
            aria-label={title}
            className="flex flex-col gap-[var(--space-1)]"
          >
            <div className="rx-row">
              <div className="rx-medicine flex flex-col gap-[var(--space-1)]">
                {row.mode === 'FREE' ? (
                  <InputField
                    id={medicineInputId(row.id)}
                    hideLabel
                    label={`${title}: ${copy.nameLabel}`}
                    placeholder={copy.nameLabel}
                    autoComplete="off"
                    value={row.medicineName}
                    onChange={(e) => update(row.id, { medicineName: e.target.value })}
                  />
                ) : row.medicineId !== null ? (
                  <div className="flex items-center gap-[var(--space-2)]">
                    <span className="type-label-strong">{row.medicineName}</span>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`${copy.change} ${n}`}
                      onClick={() =>
                        update(row.id, {
                          medicineId: null,
                          medicineName: '',
                          search: row.medicineName,
                        })
                      }
                    >
                      {copy.change}
                    </Button>
                  </div>
                ) : (
                  <MedicinePicker
                    id={medicineInputId(row.id)}
                    label={`${title}: ${copy.search}`}
                    settings={search}
                    query={row.search}
                    onQuery={(text) => update(row.id, { search: text })}
                    onPick={(hit) =>
                      update(row.id, { medicineId: hit.id, medicineName: hit.name, search: '' })
                    }
                    onUseTyped={(text) =>
                      update(row.id, {
                        mode: 'FREE',
                        medicineId: null,
                        medicineName: text,
                        search: '',
                      })
                    }
                  />
                )}
                <button
                  type="button"
                  className="type-small w-fit text-primary underline"
                  onClick={() =>
                    update(
                      row.id,
                      row.mode === 'FREE'
                        ? {
                            mode: 'LISTED',
                            medicineId: null,
                            medicineName: '',
                            search: row.medicineName,
                          }
                        : { mode: 'FREE', medicineId: null, medicineName: row.search, search: '' },
                    )
                  }
                >
                  {row.mode === 'FREE' ? copy.useList : copy.useFree}
                </button>
              </div>
              <InputField
                id={doseInputId(row.id)}
                hideLabel
                label={`${title}: ${copy.dose}`}
                placeholder={copy.dose}
                autoComplete="off"
                value={row.dose}
                onChange={(e) => update(row.id, { dose: e.target.value })}
              />
              <InputField
                hideLabel
                label={`${title}: ${copy.frequency}`}
                placeholder={copy.frequency}
                autoComplete="off"
                value={row.frequency}
                onChange={(e) => update(row.id, { frequency: e.target.value })}
              />
              <InputField
                hideLabel
                label={`${title}: ${copy.duration}`}
                placeholder={copy.duration}
                autoComplete="off"
                value={row.duration}
                onChange={(e) => update(row.id, { duration: e.target.value })}
              />
              <InputField
                hideLabel
                label={`${title}: ${copy.instructions}`}
                placeholder={copy.instructions}
                autoComplete="off"
                value={row.instructions}
                onChange={(e) => update(row.id, { instructions: e.target.value })}
                onKeyDown={(e) => {
                  // Enter in the last line's last box starts the next line (fast typing).
                  if (e.key === 'Enter' && isLast && rxRowState(row) === 'complete') {
                    e.preventDefault();
                    addRow();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                aria-label={`${copy.remove} ${n}`}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
              >
                <X aria-hidden="true" className="size-[var(--size-icon-menu)]" />
              </Button>
            </div>
            {rxRowState(row) === 'incomplete' ? (
              <p className="type-small text-destructive" role="status">
                {fill(copy.rowMissing, {
                  parts: rxMissing(row)
                    .map(
                      (part) =>
                        copy[`missing${part[0]!.toUpperCase()}${part.slice(1)}` as MissingKey],
                    )
                    .join(', '),
                })}
              </p>
            ) : null}
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" className="touch-target" onClick={addRow}>
          {copy.add}
        </Button>
      </div>
    </section>
  );
}
