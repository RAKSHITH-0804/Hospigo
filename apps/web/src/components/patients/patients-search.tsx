'use client';

import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import {
  directionForSort,
  PatientListSortColumn,
  patientsWebConfig,
  toggleSortForColumn,
  type PatientListSortColumn as SortColumn,
} from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import { ABORTED_CODE, buildListPath, errorMessageFor, patientsApi } from '@/lib/patients/client';
import { isSearchable, listUrlQuery, type PatientListParams } from '@/lib/patients/list-params';
import {
  ageDisplay,
  EMPTY_VALUE,
  formatPhoneDisplay,
  formatRegisteredOn,
  genderLabel,
  textOrEmpty,
} from '@/lib/patients/format';
import type { PatientListItem, PatientListResponse } from '@/lib/patients/types';
import { cn } from '@/lib/utils';

const copy = staffCopy.patients;

export type PatientsSearchInitial = {
  /** Applied list state (q is the text the shown rows were searched with). */
  params: PatientListParams;
  /** Text to show in the box (differs from params.q when the URL text was too short). */
  draft: string;
  result: PatientListResponse | null;
  /** Error code from the server first-paint fetch (shown through errorMessageFor). */
  errorCode: string | null;
  /** The URL had text shorter than the minimum: show the hint, list is the unfiltered one. */
  hint: boolean;
};

export type PatientsSearchProps = {
  canWrite: boolean;
  initial: PatientsSearchInitial;
  minLength: number;
  maxLength: number;
  debounceMs: number;
  pageSize: number;
  dateLocale?: string;
};

function recordHref(id: string): string {
  return `/app/patients/${encodeURIComponent(id)}`;
}

function requestKey(params: PatientListParams): string {
  return `${params.q}|${params.sort}|${params.col}|${params.page}`;
}

export function PatientsSearch({
  canWrite,
  initial,
  minLength,
  maxLength,
  debounceMs,
  pageSize,
  dateLocale = patientsWebConfig.dateLocale,
}: PatientsSearchProps) {
  const [draft, setDraft] = useState(initial.draft);
  const [params, setParams] = useState<PatientListParams>(initial.params);
  const [result, setResult] = useState<PatientListResponse | null>(initial.result);
  const [errorCode, setErrorCode] = useState<string | null>(initial.errorCode);
  const [hint, setHint] = useState(initial.hint);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Latest values for timers and async callbacks (no stale closures, no effect loops).
  const paramsRef = useRef(params);
  const requestedKey = useRef(requestKey(initial.params));
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      controller.current?.abort();
    };
  }, [clearTimer]);

  /**
   * Load a list state. Cancels the previous request, ignores out-of-order answers,
   * keeps the old rows on screen while loading and updates the URL without navigating.
   */
  const run = useCallback(
    async (next: PatientListParams, force: boolean) => {
      if (next.q && !isSearchable(next.q, minLength)) {
        setHint(true);
        return;
      }
      setHint(false);
      const key = requestKey(next);
      if (!force && key === requestedKey.current) {
        return;
      }
      requestedKey.current = key;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const id = ++requestId.current;
      setBusy(true);
      setErrorCode(null);
      const response = await patientsApi<PatientListResponse>(
        buildListPath({ sort: next.sort, page: next.page, pageSize, q: next.q }),
        { signal: abort.signal },
      );
      if (id !== requestId.current || abort.signal.aborted) {
        return;
      }
      setBusy(false);
      if (!response.ok) {
        if (response.code === ABORTED_CODE) {
          return;
        }
        if (response.status === 400 && response.fieldErrors?.q) {
          // The API is the authority on the minimum: show the hint, keep the rows.
          setHint(true);
          requestedKey.current = requestKey(paramsRef.current);
          return;
        }
        setErrorCode(response.code);
        return;
      }
      setResult(response.data);
      setParams(next);
      paramsRef.current = next;
      setSelectedId(undefined);
      // history.replaceState only: no router call, no server re-render per keystroke.
      window.history.replaceState(null, '', `${window.location.pathname}?${listUrlQuery(next)}`);
    },
    [minLength, pageSize],
  );

  // Debounced live search while typing.
  const firstDraft = useRef(true);
  useEffect(() => {
    if (firstDraft.current) {
      firstDraft.current = false;
      return;
    }
    clearTimer();
    const text = draft.trim();
    timer.current = setTimeout(() => {
      timer.current = null;
      void run({ ...paramsRef.current, q: text, page: 1 }, false);
    }, debounceMs);
    return clearTimer;
  }, [draft, debounceMs, run, clearTimer]);

  function searchNow(text: string) {
    clearTimer();
    void run({ ...paramsRef.current, q: text.trim(), page: 1 }, true);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchNow(draft);
  }

  function onClearText() {
    setDraft('');
    searchNow('');
  }

  function onHeaderSort(column: SortColumn) {
    const current = paramsRef.current;
    const nextSort = toggleSortForColumn(column, current.sort, current.col);
    void run({ ...current, sort: nextSort, col: column, page: 1 }, true);
  }

  function goToPage(page: number) {
    void run({ ...paramsRef.current, page }, true);
  }

  function sortAria(column: SortColumn, label: string): string {
    const dir = params.col === column ? directionForSort(column, params.sort) : null;
    if (dir === 'asc') {
      return copy.search.sortAscending.replace('{column}', label);
    }
    if (dir === 'desc') {
      return copy.search.sortDescending.replace('{column}', label);
    }
    return copy.search.sortNeutral.replace('{column}', label);
  }

  function sortColumn(
    column: SortColumn,
    header: string,
  ): Pick<
    DataTableColumn<PatientListItem>,
    'sortable' | 'sortDirection' | 'sortAriaLabel' | 'onSort'
  > {
    return {
      sortable: true,
      sortDirection: params.col === column ? directionForSort(column, params.sort) : null,
      sortAriaLabel: sortAria(column, header),
      onSort: () => onHeaderSort(column),
    };
  }

  const selected = result?.items.find((item) => item.id === selectedId);
  const totalPages = result ? Math.max(Math.ceil(result.total / result.pageSize), 1) : 0;
  const hasFilter = Boolean(params.q);
  const minHint = copy.search.minLengthHint.replace('{min}', String(minLength));
  const countLine =
    hasFilter && result && result.total > 0
      ? copy.search.countLine.replace('{total}', String(result.total)).replace('{query}', params.q)
      : null;

  const columns: Array<DataTableColumn<PatientListItem>> = [
    {
      id: 'uhid',
      header: copy.search.columns.uhid,
      cell: (row) => row.uhid,
      ...sortColumn(PatientListSortColumn.UHID, copy.search.columns.uhid),
    },
    {
      id: 'name',
      header: copy.search.columns.name,
      cell: (row) => (
        <Link
          href={recordHref(row.id)}
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.name}
        </Link>
      ),
      ...sortColumn(PatientListSortColumn.NAME, copy.search.columns.name),
    },
    {
      id: 'gender',
      header: copy.search.columns.gender,
      cell: (row) => genderLabel(row.gender),
      hideOnPhone: true,
    },
    {
      id: 'age',
      header: copy.search.columns.age,
      cell: (row) => (row.ageYears === null ? EMPTY_VALUE : ageDisplay(row)),
    },
    {
      id: 'phone',
      header: copy.search.columns.phone,
      cell: (row) => formatPhoneDisplay(row.phone),
      nowrap: true,
    },
    {
      id: 'branch',
      header: copy.search.columns.branch,
      cell: (row) => textOrEmpty(row.registeredBranchName),
      hideOnPhone: true,
    },
    {
      id: 'registeredOn',
      header: copy.search.columns.registeredOn,
      cell: (row) => formatRegisteredOn(row.createdAt, dateLocale),
      hideOnPhone: true,
      ...sortColumn(PatientListSortColumn.REGISTERED, copy.search.columns.registeredOn),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <form
        onSubmit={onSubmit}
        role="search"
        aria-label={copy.title}
        className="patients-search-toolbar"
        data-testid="patients-search-row"
      >
        <div className="patients-search-controls">
          <div className="patients-search-field">
            <label htmlFor="patients-q" className="sr-only">
              {copy.search.inputLabel}
            </label>
            <span className="patients-search-icon" aria-hidden="true">
              <Search className="size-[var(--size-icon-menu)]" />
            </span>
            <input
              id="patients-q"
              type="text"
              role="searchbox"
              value={draft}
              maxLength={maxLength}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={copy.search.inputPlaceholder}
              autoComplete="off"
              className="patients-search-input"
            />
            {draft ? (
              <button
                type="button"
                className="patients-search-clear-input"
                aria-label={copy.search.clearInputAria}
                onClick={onClearText}
              >
                <X aria-hidden="true" className="size-[var(--size-icon-menu)]" />
              </button>
            ) : null}
          </div>
          <Button type="submit" className="patients-search-submit">
            {copy.search.submit}
          </Button>
        </div>
      </form>

      {hint ? (
        <p
          role="status"
          className="type-small text-muted-foreground"
          data-testid="patients-search-hint"
        >
          {minHint}
        </p>
      ) : null}
      {countLine ? (
        <p className="type-small text-muted-foreground" data-testid="patients-search-count">
          {countLine}
        </p>
      ) : null}
      {errorCode ? (
        <div role="alert" className="type-label text-destructive">
          <p className="font-medium">{copy.search.errorTitle}</p>
          <p>{errorMessageFor(errorCode)}</p>
        </div>
      ) : null}

      {result ? (
        result.items.length === 0 ? (
          hasFilter ? (
            <EmptyState
              title={copy.search.noResultTitle}
              description={copy.search.noResultDescription}
            />
          ) : (
            <EmptyState
              title={copy.search.emptyTitle}
              description={
                canWrite ? copy.search.emptyDescription : copy.search.emptyReadOnlyDescription
              }
              action={
                canWrite ? (
                  <Link href="/app/patients/new" className={cn(buttonVariants(), 'touch-target')}>
                    {copy.registerAction}
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <div
            className="patients-search-layout patients-busy"
            data-panel={selected ? 'open' : 'closed'}
            aria-busy={busy}
            data-busy={busy ? 'true' : 'false'}
          >
            <div className="flex min-w-0 flex-col gap-[var(--space-3)]">
              <DataTable
                columns={columns}
                rows={result.items}
                ariaLabel={copy.title}
                selectedId={selectedId}
                onRowSelect={setSelectedId}
              />
              <Pagination
                page={result.page}
                totalPages={totalPages}
                total={result.total}
                previousLabel={staffCopy.pagination.previous}
                nextLabel={staffCopy.pagination.next}
                pageOfLabel={staffCopy.pagination.pageOf}
                totalLabel={staffCopy.pagination.total}
                onPrevious={() => goToPage(result.page - 1)}
                onNext={() => goToPage(result.page + 1)}
              />
            </div>
            {selected ? (
              <aside aria-label={copy.search.quickView.title}>
                <Card>
                  <CardHeader>
                    <CardTitle className="section-heading">{copy.search.quickView.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-[var(--space-3)]">
                    <dl className="flex flex-col gap-[var(--space-2)] type-label">
                      <div>
                        <dt className="text-muted-foreground">{copy.search.quickView.uhid}</dt>
                        <dd>{selected.uhid}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.search.quickView.name}</dt>
                        <dd>
                          <Link
                            href={recordHref(selected.id)}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {selected.name}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.search.quickView.gender}</dt>
                        <dd>{genderLabel(selected.gender)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.search.quickView.age}</dt>
                        <dd>{selected.ageYears === null ? EMPTY_VALUE : ageDisplay(selected)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.search.quickView.phone}</dt>
                        <dd>{formatPhoneDisplay(selected.phone)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy.search.quickView.branch}</dt>
                        <dd>{textOrEmpty(selected.registeredBranchName)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          {copy.search.quickView.registeredOn}
                        </dt>
                        <dd>{formatRegisteredOn(selected.createdAt, dateLocale)}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-[var(--space-2)]">
                      <Link
                        href={recordHref(selected.id)}
                        className={cn(buttonVariants(), 'touch-target')}
                      >
                        {copy.search.quickView.openRecord}
                      </Link>
                      {canWrite ? (
                        <Link
                          href={`${recordHref(selected.id)}/edit`}
                          className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
                        >
                          {copy.record.editAction}
                        </Link>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        className="touch-target"
                        onClick={() => setSelectedId(undefined)}
                      >
                        {copy.search.quickView.close}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </aside>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
