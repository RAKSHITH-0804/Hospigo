'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { SelectField } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { importScreenConfig } from '@/config/imports';
import { staffCopy } from '@/config/staff-copy';
import {
  getImport,
  importAction,
  importRows,
  listImports,
  templateHref,
  uploadImport,
} from '@/lib/imports/client';
import { batchProblemText, importErrorMessage } from '@/lib/imports/errors';
import {
  IMPORT_PRICE_TYPES,
  IMPORT_TYPES,
  type ImportAction,
  type ImportBatch,
  type ImportListResponse,
  type ImportRow,
  type ImportRowsResponse,
  type ImportType,
} from '@/lib/imports/types';
import { errorMessageFor } from '@/lib/patients/client';
import { formatDateOnly } from '@/lib/patients/format';

const copy = staffCopy.imports;
const paging = staffCopy.pagination;

type StateKey = keyof typeof copy.states;
type Flash = { kind: 'ok' | 'error'; text: string } | null;
type RowView = 'EXCEPTION' | 'VALID';

/** The one sentence that says where a batch is (the API keeps the status; this only words it). */
export function stateOf(batch: ImportBatch): { key: StateKey; variant: BadgeVariant } {
  if (batch.status === 'FAILED') {
    return batch.runStatus === 'CANCELLED'
      ? { key: 'cancelled', variant: 'neutral' }
      : { key: 'failed', variant: 'danger' };
  }
  if (batch.status === 'POSTED') {
    return { key: 'saved', variant: 'success' };
  }
  if (batch.status === 'APPROVED') {
    if (batch.runStatus === 'POSTING') {
      return { key: batch.runStale ? 'slow' : 'saving', variant: 'info' };
    }
    return batch.runStatus === 'POST_FAILED'
      ? { key: 'saveFailed', variant: 'danger' }
      : { key: 'approved', variant: 'warning' };
  }
  if (batch.status === 'PREVIEWED') {
    return { key: 'checked', variant: 'warning' };
  }
  return { key: batch.runStale ? 'slow' : 'reading', variant: 'info' };
}

const isRunning = (b: ImportBatch): boolean =>
  !b.runStale && (b.runStatus === 'PREVIEWING' || b.runStatus === 'POSTING');

type RowTable = ImportRow & { id: string };

/**
 * Settings, OPD, Upload lists: upload an Excel file of tests (with prices), doctor fees or medicines,
 * see what it would do (nothing is saved at that point), approve, and save. The API reads the file in
 * the background; this screen asks for the status until it is ready. The API decides every rule.
 */
export function ImportsScreen({
  initial,
  initialErrorCode,
  allowPrices,
}: {
  initial: ImportListResponse | null;
  initialErrorCode: string | null;
  allowPrices: boolean;
}) {
  const types = IMPORT_TYPES.filter((t) => allowPrices || !IMPORT_PRICE_TYPES.includes(t));
  const [type, setType] = useState<ImportType>(types[0] ?? 'MEDICINES');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [current, setCurrent] = useState<ImportBatch | null>(null);
  const [rowView, setRowView] = useState<RowView>('EXCEPTION');
  const [rows, setRows] = useState<ImportRowsResponse | null>(null);
  const [rowPage, setRowPage] = useState(1);
  const [history, setHistory] = useState(initial);
  const [historyPage, setHistoryPage] = useState(1);
  const [working, setWorking] = useState<ImportAction | null>(null);
  const busy = useRef(false);
  const firstHistory = useRef(true);

  const refreshHistory = useCallback(async (page: number) => {
    const result = await listImports(page, importScreenConfig.historyPageSize);
    if (result.ok) {
      setHistory(result.data);
    }
  }, []);

  // The history pages.
  useEffect(() => {
    if (firstHistory.current) {
      firstHistory.current = false;
      return;
    }
    void refreshHistory(historyPage);
  }, [historyPage, refreshHistory]);

  // While the API reads or saves the file in the background, ask for the status.
  const currentId = current?.id ?? null;
  const running = current ? isRunning(current) : false;
  useEffect(() => {
    if (!currentId || !running) {
      return;
    }
    const timer = setTimeout(async () => {
      const result = await getImport(currentId);
      if (result.ok) {
        setCurrent(result.data);
        if (!isRunning(result.data)) {
          // The check is finished: show the problems first when there are some.
          setRowView(result.data.exceptionRows > 0 ? 'EXCEPTION' : 'VALID');
          setRowPage(1);
          void refreshHistory(historyPage);
        }
      }
    }, importScreenConfig.pollMs);
    return () => clearTimeout(timer);
  }, [currentId, running, current, historyPage, refreshHistory]);

  // The rows of the batch that is open (problems first when there are some).
  const status = current?.status ?? null;
  const settled = current !== null && !running;
  const exceptionRows = current?.exceptionRows ?? 0;
  useEffect(() => {
    if (
      !currentId ||
      !settled ||
      (status !== 'PREVIEWED' && status !== 'APPROVED' && status !== 'POSTED')
    ) {
      setRows(null);
      return;
    }
    let live = true;
    void importRows(currentId, rowView, rowPage, importScreenConfig.rowsPageSize).then((result) => {
      if (live && result.ok) {
        setRows(result.data);
      }
    });
    return () => {
      live = false;
    };
  }, [currentId, settled, status, rowView, rowPage, exceptionRows]);

  function open(batch: ImportBatch) {
    setCurrent(batch);
    setRowView(batch.exceptionRows > 0 ? 'EXCEPTION' : 'VALID');
    setRowPage(1);
    setRows(null);
    setFlash(null);
  }

  async function onUpload() {
    if (busy.current) {
      return;
    }
    if (!file) {
      setFlash({ kind: 'error', text: copy.noFile });
      return;
    }
    busy.current = true;
    setUploading(true);
    setFlash(null);
    const result = await uploadImport(type, file);
    busy.current = false;
    setUploading(false);
    if (!result.ok) {
      setFlash({ kind: 'error', text: importErrorMessage(result) });
      return;
    }
    setFile(null);
    setFileKey((n) => n + 1);
    open(result.data);
    setHistoryPage(1);
    void refreshHistory(1);
  }

  async function onAction(action: ImportAction) {
    if (busy.current || !current) {
      return;
    }
    busy.current = true;
    setWorking(action);
    setFlash(null);
    const result = await importAction(current.id, action);
    busy.current = false;
    setWorking(null);
    if (!result.ok) {
      setFlash({ kind: 'error', text: importErrorMessage(result) });
      const fresh = await getImport(current.id);
      if (fresh.ok) {
        setCurrent(fresh.data);
      }
      return;
    }
    setCurrent(result.data);
    void refreshHistory(historyPage);
  }

  if (!history && !current) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }

  const state = current ? stateOf(current) : null;
  const problem = current ? batchProblemText(current.errorMessage) : null;
  const finished = current !== null && (current.status === 'POSTED' || current.status === 'FAILED');

  const rowColumns: DataTableColumn<RowTable>[] = [
    { id: 'row', header: copy.rowColumns.row, nowrap: true, cell: (r) => r.rowNumber },
    { id: 'value', header: copy.rowColumns.value, cell: (r) => r.matchKey },
    rowView === 'EXCEPTION'
      ? {
          id: 'problem',
          header: copy.rowColumns.problem,
          cell: (r) =>
            copy.problemLine
              .replace('{reason}', copy.rowReasons[r.reason ?? ''] ?? copy.fileFallback)
              .replace('{column}', copy.columnNames[r.field ?? ''] ?? r.field ?? ''),
        }
      : {
          id: 'action',
          header: copy.rowColumns.action,
          cell: (r) => copy.actions[r.action ?? 'NONE'] ?? '',
        },
  ];

  const historyColumns: DataTableColumn<ImportBatch>[] = [
    {
      id: 'when',
      header: copy.historyColumns.when,
      nowrap: true,
      cell: (b) => formatDateOnly(b.createdAt),
    },
    { id: 'list', header: copy.historyColumns.list, cell: (b) => copy.types[b.type] ?? b.type },
    { id: 'file', header: copy.historyColumns.file, hideOnPhone: true, cell: (b) => b.fileName },
    {
      id: 'by',
      header: copy.historyColumns.by,
      hideOnPhone: true,
      cell: (b) => b.createdByName ?? '—',
    },
    {
      id: 'state',
      header: copy.historyColumns.state,
      cell: (b) => {
        const s = stateOf(b);
        return <Badge variant={s.variant}>{copy.states[s.key]}</Badge>;
      },
    },
    {
      id: 'rows',
      header: copy.historyColumns.rows,
      nowrap: true,
      hideOnPhone: true,
      cell: (b) => b.totalRows,
    },
    {
      id: 'open',
      header: copy.historyColumns.open,
      cell: (b) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${b.fileName}: ${copy.open}`}
          onClick={() => open(b)}
        >
          {copy.open}
        </Button>
      ),
    },
  ];

  const totalRowPages = rows ? Math.max(Math.ceil(rows.total / rows.pageSize), 1) : 1;
  const totalHistoryPages = history ? Math.max(Math.ceil(history.total / history.pageSize), 1) : 1;

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      <div className="surface-card section-stack">
        <div className="cluster">
          <SelectField
            label={copy.typeLabel}
            value={type}
            onChange={(event) => setType(event.target.value as ImportType)}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {copy.types[t]}
              </option>
            ))}
          </SelectField>
          <a
            className="type-label text-primary underline-offset-4 hover:underline"
            href={templateHref(type)}
          >
            {copy.sample}
          </a>
        </div>
        <p className="type-small text-muted-foreground">{copy.typeHints[type]}</p>
        <div className="cluster">
          <label className="field-label">
            {copy.fileLabel}
            <input
              key={fileKey}
              type="file"
              className="field-input"
              accept={importScreenConfig.accept}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Button type="button" onClick={() => void onUpload()} disabled={uploading}>
            {uploading ? copy.uploading : copy.upload}
          </Button>
        </div>
        <p
          role={flash?.kind === 'error' ? 'alert' : 'status'}
          className={`settings-flash settings-flash-lazy type-label ${flash?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
        >
          {flash?.text ?? ''}
        </p>
      </div>

      {current && state ? (
        <section
          className="surface-card section-stack"
          aria-label={copy.batchTitle.replace('{name}', current.fileName)}
        >
          <div className="cluster-between">
            <h3 className="type-label-strong">
              {copy.batchTitle.replace('{name}', current.fileName)}
            </h3>
            <Badge variant={state.variant}>{copy.states[state.key]}</Badge>
          </div>
          {problem ? (
            <p role="alert" className="type-label text-destructive">
              {problem}
            </p>
          ) : null}
          {current.status === 'PREVIEWED' || current.status === 'APPROVED' ? (
            <p className="type-label">
              {copy.counts
                .replace('{total}', String(current.totalRows))
                .replace('{valid}', String(current.validRows))
                .replace('{unchanged}', String(current.unchangedRows))
                .replace('{problems}', String(current.exceptionRows))}
            </p>
          ) : null}
          {current.status === 'POSTED' ? (
            <p className="type-label">
              {copy.savedCounts.replace('{posted}', String(current.postedRows))}
            </p>
          ) : null}

          <div className="cluster">
            {current.status === 'PREVIEWED' && !running ? (
              <Button
                type="button"
                disabled={working !== null || current.validRows < 1}
                onClick={() => void onAction('approve')}
              >
                {copy.approve}
              </Button>
            ) : null}
            {current.status === 'APPROVED' && !running ? (
              <Button
                type="button"
                disabled={working !== null}
                onClick={() => void onAction('post')}
              >
                {current.runStatus === 'POST_FAILED' ? copy.retry : copy.save}
              </Button>
            ) : null}
            {(current.status === 'DRAFT' ||
              current.status === 'PREVIEWED' ||
              current.status === 'APPROVED') &&
            !(current.runStatus === 'POSTING' && !current.runStale) ? (
              <Button
                type="button"
                variant="outline"
                disabled={working !== null}
                onClick={() => void onAction('cancel')}
              >
                {copy.cancel}
              </Button>
            ) : null}
            {finished ? (
              <Button type="button" variant="outline" onClick={() => setCurrent(null)}>
                {copy.another}
              </Button>
            ) : null}
          </div>

          {rows && current.status !== 'FAILED' ? (
            <div className="section-stack">
              <div className="cluster">
                <h4 className="type-label-strong">
                  {rowView === 'EXCEPTION' ? copy.problemsTitle : copy.okTitle}
                </h4>
                {current.exceptionRows > 0 && current.validRows > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRowView(rowView === 'EXCEPTION' ? 'VALID' : 'EXCEPTION');
                      setRowPage(1);
                    }}
                  >
                    {rowView === 'EXCEPTION' ? copy.okTitle : copy.problemsTitle}
                  </Button>
                ) : null}
              </div>
              {rows.items.length === 0 ? (
                <p className="type-label text-muted-foreground">
                  {rowView === 'EXCEPTION' ? copy.noProblems : copy.noRows}
                </p>
              ) : (
                <DataTable<RowTable>
                  ariaLabel={rowView === 'EXCEPTION' ? copy.problemsTitle : copy.okTitle}
                  columns={rowColumns}
                  rows={rows.items.map((r) => ({ ...r, id: String(r.rowNumber) }))}
                  stackOnPhone
                />
              )}
              <Pagination
                page={rows.page}
                totalPages={totalRowPages}
                total={rows.total}
                previousLabel={paging.previous}
                nextLabel={paging.next}
                pageOfLabel={paging.pageOf}
                totalLabel={paging.total}
                onPrevious={() => setRowPage((p) => Math.max(p - 1, 1))}
                onNext={() => setRowPage((p) => Math.min(p + 1, totalRowPages))}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="section-stack" aria-label={copy.historyTitle}>
        <h3 className="type-label-strong">{copy.historyTitle}</h3>
        {!history || history.items.length === 0 ? (
          <p className="type-label text-muted-foreground">{copy.emptyHistory}</p>
        ) : (
          <>
            <DataTable<ImportBatch>
              ariaLabel={copy.historyTitle}
              columns={historyColumns}
              rows={history.items}
              stackOnPhone
            />
            <Pagination
              page={history.page}
              totalPages={totalHistoryPages}
              total={history.total}
              previousLabel={paging.previous}
              nextLabel={paging.next}
              pageOfLabel={paging.pageOf}
              totalLabel={paging.total}
              onPrevious={() => setHistoryPage((p) => Math.max(p - 1, 1))}
              onNext={() => setHistoryPage((p) => Math.min(p + 1, totalHistoryPages))}
            />
          </>
        )}
      </section>
    </SettingBlock>
  );
}
