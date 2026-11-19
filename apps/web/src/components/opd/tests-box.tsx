'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { searchTests } from '@/lib/opd/tests-client';
import { canRemoveChip, statusKind, type TestChip } from '@/lib/opd/tests-draft';
import { orderStatusText } from '@/lib/opd/tests-labels';
import type { TestItem } from '@/lib/opd/tests-types';
import { ABORTED_CODE } from '@/lib/patients/client';

const copy = staffCopy.opd.tests.doctor;

export type TestsSearchSettings = { minChars: number; debounceMs: number; limit: number };

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; hits: TestItem[] };

/**
 * The doctor's Tests box: the tests chosen for this visit as chips (a test that is still only
 * ordered can be taken off; a billed or declined one stays) and a search over the hospital's tests
 * list. No prices are shown. The list is saved together with the note by the consultation screen.
 */
export function TestsBox({
  chips,
  onAdd,
  onRemove,
  readOnly,
  search,
}: {
  chips: TestChip[];
  onAdd: (test: TestItem) => void;
  onRemove: (chargeItemId: string) => void;
  readOnly: boolean;
  search: TestsSearchSettings;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });

  useEffect(() => {
    const text = query.trim();
    if (readOnly || text.length < search.minChars) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      void searchTests(text, search.limit, controller.signal).then((result) => {
        if (controller.signal.aborted || (!result.ok && result.code === ABORTED_CODE)) {
          return;
        }
        setState(result.ok ? { status: 'ready', hits: result.data.items } : { status: 'error' });
      });
    }, search.debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, readOnly, search.minChars, search.debounceMs, search.limit]);

  const chosen = new Set(chips.map((c) => c.chargeItemId));
  const hits = state.status === 'ready' ? state.hits.filter((h) => !chosen.has(h.id)) : [];

  return (
    <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.heading}>
      <h3 className="type-label-strong">{copy.heading}</h3>
      {chips.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-[var(--space-2)]" aria-label={copy.heading}>
          {chips.map((chip) => (
            <li key={chip.chargeItemId} className="flex items-center gap-[var(--space-2)]">
              <Badge variant={statusKind(chip.status) === 'ordered' ? 'info' : 'neutral'}>
                {chip.name} · {orderStatusText(chip.status, chip.notTakenReason)}
              </Badge>
              {!readOnly && canRemoveChip(chip) ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={fill(copy.removeLabel, { name: chip.name })}
                  onClick={() => onRemove(chip.chargeItemId)}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <div className="relative flex flex-col gap-[var(--space-2)]">
          <InputField
            id="tests-search"
            hideLabel
            label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {state.status === 'error' ? (
            <p role="alert" className="type-small text-destructive">
              {copy.searchError}
            </p>
          ) : null}
          {state.status === 'ready' && hits.length === 0 ? (
            <p className="type-small text-muted-foreground">{copy.searchNone}</p>
          ) : null}
          {hits.length > 0 ? (
            <ul className="rx-hits" aria-label={copy.searchLabel}>
              {hits.map((hit) => (
                <li key={hit.id}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onAdd(hit);
                      setQuery('');
                    }}
                  >
                    {hit.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="type-small text-muted-foreground">{copy.paidHint}</p>
        </div>
      )}
    </section>
  );
}
