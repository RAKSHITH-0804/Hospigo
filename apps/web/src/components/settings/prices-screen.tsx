'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { InputField, SelectField } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { ErrorState } from '@/components/states/error-state';
import { formatPaise, parseRupeesToPaise, paiseToRupeesText } from '@/config/money';
import { opdWebConfig } from '@/config/opd';
import { settingsScreenConfig, staffScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { formatDateOnly } from '@/lib/patients/format';
import { errorMessageFor } from '@/lib/patients/client';
import { changePrice, listPrices, priceHistory } from '@/lib/prices/client';
import { priceErrorMessage } from '@/lib/prices/errors';
import {
  PRICE_KINDS,
  type PriceKind,
  type PriceRow,
  type PricesResponse,
  type PriceVersion,
} from '@/lib/prices/types';

const copy = staffCopy.prices;
const paging = staffCopy.pagination;

type Flash = { kind: 'ok' | 'error'; text: string } | null;
type TableRow = PriceRow & { id: string };

function typeText(row: PriceRow): string {
  return copy.types[row.kind === 'DOCTOR_FEE' ? (row.visitType ?? '') : row.kind] ?? row.kind;
}

/**
 * Settings, OPD, Prices: the registration fee, every test and every doctor fee with the price now
 * and the next scheduled price, a history per row and a form to change a price. A change adds a new
 * version that starts on the chosen date (never before today); old bills keep their price. The API
 * checks the permission and every value; this screen only shows what it answers.
 */
export function PricesScreen({
  initial,
  initialErrorCode,
}: {
  initial: PricesResponse | null;
  initialErrorCode: string | null;
}) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<PriceKind | ''>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [historyRow, setHistoryRow] = useState<PriceRow | null>(null);
  const [history, setHistory] = useState<PriceVersion[] | 'error' | null>(null);
  const busy = useRef(false);
  const first = useRef(true);
  const [reloadTick, setReloadTick] = useState(0);

  // "Saved." fades away by itself; an error stays until the next action.
  useEffect(() => {
    if (flash?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setFlash(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [flash]);

  // Search, filter, page and a saved change ask the API again (after a short pause while typing).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let live = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setListError(null);
        void listPrices({ q: q.trim(), kind, page }).then((result) => {
          if (!live) {
            return;
          }
          setLoading(false);
          if (result.ok) {
            setData(result.data);
          } else {
            setListError(errorMessageFor(result.code));
          }
        });
      },
      page === 1 && reloadTick === 0 ? staffScreenConfig.searchDebounceMs : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, kind, page, reloadTick]);

  if (!data) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1);

  function openEditor(row: PriceRow) {
    setEditing(row);
    setHistoryRow(null);
    setAmountText(row.currentAmountPaise === null ? '' : paiseToRupeesText(row.currentAmountPaise));
    setAmountError(null);
    setDate(data?.today ?? '');
    setFlash(null);
  }

  async function openHistory(row: PriceRow) {
    if (historyRow?.key === row.key) {
      setHistoryRow(null);
      return;
    }
    setHistoryRow(row);
    setEditing(null);
    setHistory(null);
    const result = await priceHistory(row);
    setHistory(result.ok ? result.data.items : 'error');
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !editing) {
      return;
    }
    const amountPaise = parseRupeesToPaise(amountText);
    if (amountPaise === null) {
      setAmountError(copy.errors.invalidAmount);
      return;
    }
    setAmountError(null);
    busy.current = true;
    setSaving(true);
    setFlash(null);
    const result = await changePrice(editing, { amountPaise, effectiveFrom: date || undefined });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setFlash({ kind: 'error', text: priceErrorMessage(result) });
      return;
    }
    setFlash({ kind: 'ok', text: result.data.changed ? copy.saved : copy.unchanged });
    setEditing(null);
    setReloadTick((n) => n + 1);
  }

  const columns: DataTableColumn<TableRow>[] = [
    {
      id: 'name',
      header: copy.columns.name,
      cell: (row) => (
        <div className="settings-cell-name">
          <span className="type-label-strong">{row.name}</span>
          <span className="type-small text-muted-foreground">{row.code}</span>
        </div>
      ),
    },
    { id: 'type', header: copy.columns.type, cell: (row) => typeText(row), hideOnPhone: true },
    {
      id: 'current',
      header: copy.columns.current,
      nowrap: true,
      cell: (row) =>
        row.currentAmountPaise === null ? (
          <Badge variant="warning">{copy.noPrice}</Badge>
        ) : (
          formatPaise(row.currentAmountPaise)
        ),
    },
    {
      id: 'since',
      header: copy.columns.since,
      hideOnPhone: true,
      nowrap: true,
      cell: (row) => (row.currentFrom ? formatDateOnly(row.currentFrom) : copy.noNext),
    },
    {
      id: 'next',
      header: copy.columns.next,
      hideOnPhone: true,
      cell: (row) =>
        row.nextAmountPaise !== null && row.nextFrom
          ? copy.nextOn
              .replace('{amount}', formatPaise(row.nextAmountPaise))
              .replace('{date}', formatDateOnly(row.nextFrom))
          : copy.noNext,
    },
    {
      id: 'actions',
      header: copy.columns.actions,
      cell: (row) => (
        <div className="cluster">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${row.name}: ${row.currentAmountPaise === null ? copy.setFirst : copy.change}`}
            onClick={() => openEditor(row)}
          >
            {row.currentAmountPaise === null ? copy.setFirst : copy.change}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${row.name}: ${copy.history}`}
            onClick={() => void openHistory(row)}
          >
            {copy.history}
          </Button>
        </div>
      ),
    },
  ];

  const rows: TableRow[] = data.items.map((row) => ({ ...row, id: row.key }));
  const firstPrice = editing !== null && editing.currentAmountPaise === null;

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      <div className="cluster">
        <InputField
          label={copy.searchLabel}
          placeholder={copy.searchPlaceholder}
          value={q}
          maxLength={60}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <SelectField
          label={copy.kindLabel}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as PriceKind | '');
            setPage(1);
          }}
        >
          <option value="">{copy.kinds.ALL}</option>
          {PRICE_KINDS.map((k) => (
            <option key={k} value={k}>
              {copy.kinds[k]}
            </option>
          ))}
        </SelectField>
      </div>

      <p
        role={flash?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${flash?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {flash?.text ?? ''}
      </p>

      {editing ? (
        <form className="surface-card section-stack" onSubmit={onSubmit} noValidate>
          <h3 className="type-label-strong">
            {(firstPrice ? copy.setTitle : copy.changeTitle).replace('{name}', editing.name)}
          </h3>
          <p className="type-small text-muted-foreground">
            {copy.typeLine.replace('{type}', typeText(editing)).replace('{code}', editing.code)}
            {editing.currentAmountPaise !== null
              ? ` · ${copy.currentLine.replace('{amount}', formatPaise(editing.currentAmountPaise))}`
              : ''}
          </p>
          <div className="cluster">
            <InputField
              label={copy.amountLabel}
              hint={copy.amountHint}
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              error={amountError ?? undefined}
              onChange={(event) => setAmountText(event.target.value)}
            />
            <DatePicker
              label={copy.dateLabel}
              value={date}
              min={firstPrice ? undefined : data.today}
              todayIso={data.today}
              weekStart={opdWebConfig.calendarWeekStart}
              quickDays={[]}
              quickPicks={[
                { label: copy.today, days: 0 },
                { label: copy.tomorrow, days: 1 },
              ]}
              onChange={(iso) => setDate(iso)}
            />
          </div>
          <div className="cluster">
            <Button type="submit" disabled={saving}>
              {saving ? copy.saving : copy.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setEditing(null)}
            >
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {historyRow ? (
        <section className="surface-card section-stack" aria-label={copy.history}>
          <div className="cluster-between">
            <h3 className="type-label-strong">
              {copy.historyTitle.replace('{name}', historyRow.name)}
            </h3>
            <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryRow(null)}>
              {copy.close}
            </Button>
          </div>
          {history === null ? (
            <p role="status" className="type-label text-muted-foreground">
              {copy.loading}…
            </p>
          ) : history === 'error' ? (
            <p role="alert" className="type-label text-destructive">
              {copy.historyLoadError}
            </p>
          ) : history.length === 0 ? (
            <p className="type-label text-muted-foreground">{copy.historyEmpty}</p>
          ) : (
            <DataTable<PriceVersion>
              ariaLabel={copy.history}
              columns={[
                {
                  id: 'price',
                  header: copy.historyColumns.price,
                  nowrap: true,
                  cell: (v) => formatPaise(v.amountPaise),
                },
                {
                  id: 'from',
                  header: copy.historyColumns.from,
                  nowrap: true,
                  cell: (v) => formatDateOnly(v.effectiveFrom),
                },
                {
                  id: 'by',
                  header: copy.historyColumns.by,
                  hideOnPhone: true,
                  cell: (v) => v.createdByName ?? copy.noNext,
                },
                {
                  id: 'state',
                  header: copy.historyColumns.state,
                  cell: (v) =>
                    v.inEffect ? (
                      <Badge variant="success">{copy.stateInEffect}</Badge>
                    ) : new Date(v.effectiveFrom).getTime() > Date.now() ? (
                      <Badge variant="info">{copy.stateScheduled}</Badge>
                    ) : (
                      <Badge variant="neutral">{copy.stateOld}</Badge>
                    ),
                },
              ]}
              rows={history}
            />
          )}
        </section>
      ) : null}

      {listError ? (
        <ErrorState message={listError} onRetry={() => setReloadTick((n) => n + 1)} />
      ) : loading && rows.length === 0 ? (
        <p role="status" className="type-label text-muted-foreground">
          {copy.loading}…
        </p>
      ) : rows.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <DataTable<TableRow> ariaLabel={copy.title} columns={columns} rows={rows} stackOnPhone />
      )}

      <Pagination
        page={data.page}
        totalPages={totalPages}
        total={data.total}
        previousLabel={paging.previous}
        nextLabel={paging.next}
        pageOfLabel={paging.pageOf}
        totalLabel={paging.total}
        onPrevious={() => setPage((p) => Math.max(p - 1, 1))}
        onNext={() => setPage((p) => Math.min(p + 1, totalPages))}
      />
    </SettingBlock>
  );
}
