'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { changeNumberSeries, listNumberSeries, raiseStartNumber } from '@/lib/masters/client';
import { masterErrorMessage } from '@/lib/masters/errors';
import { previewNumber } from '@/lib/masters/number-preview';
import type { SeriesKind, SeriesResponse, SeriesRow } from '@/lib/masters/types';
import { errorMessageFor } from '@/lib/patients/client';

const copy = staffCopy.masters.numberSeries;

type Flash = { kind: 'ok' | 'error'; text: string } | null;
type FormatDraft = {
  prefix: string;
  separator: string;
  fyStyle: 'SHORT' | 'LONG';
  width: string;
  resetRule: 'NEVER' | 'FINANCIAL_YEAR';
  fyStartMonth: string;
};
type Dialog = { kind: 'format' | 'start'; row: SeriesRow } | null;

const WIDTHS = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * Settings, Billing, Bill numbers: the format of the bill, receipt and refund numbers. A number once
 * issued is never touched, so a change only affects new numbers. The reset rule and the financial
 * year start are locked once a number exists. The start number only raises the counter. Only a
 * hospital-wide Admin may use it (the API checks). The preview is worked out here with the same rules.
 */
export function NumberSeriesScreen({
  initial,
  initialErrorCode,
}: {
  initial: SeriesResponse | null;
  initialErrorCode: string | null;
}) {
  const [rows, setRows] = useState<SeriesRow[]>(initial?.items ?? []);
  const today = initial?.today ?? '';
  const [loadError, setLoadError] = useState<string | null>(
    initial ? null : initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError,
  );
  const [reloading, setReloading] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [format, setFormat] = useState<FormatDraft | null>(null);
  const [startNumber, setStartNumber] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [dateToday, setDateToday] = useState(today);
  const busy = useRef(false);

  useEffect(() => {
    if (flash?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setFlash(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [flash]);

  async function reload() {
    setReloading(true);
    const result = await listNumberSeries();
    setReloading(false);
    if (result.ok) {
      setRows(result.data.items);
      setDateToday(result.data.today);
      setLoadError(null);
    } else {
      setLoadError(errorMessageFor(result.code));
    }
  }

  if (loadError && rows.length === 0) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <div className="cluster">
          <p role="alert" className="type-label text-destructive">
            {loadError}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reloading}
            onClick={() => void reload()}
          >
            {copy.retry}
          </Button>
        </div>
      </SettingBlock>
    );
  }

  const put = (row: SeriesRow) =>
    setRows((all) => all.map((r) => (r.series === row.series ? row : r)));

  function openFormat(row: SeriesRow) {
    setDialog({ kind: 'format', row });
    setDialogError(null);
    setFormat({
      prefix: row.prefix,
      separator: row.separator,
      fyStyle: row.fyStyle,
      width: String(row.width),
      resetRule: row.resetRule,
      fyStartMonth: String(row.fyStartMonth),
    });
  }

  function openStart(row: SeriesRow) {
    setDialog({ kind: 'start', row });
    setDialogError(null);
    setStartNumber('');
    setReason('');
  }

  function close() {
    setDialog(null);
    setFormat(null);
  }

  async function saveFormat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !dialog || !format) {
      return;
    }
    const row = dialog.row;
    const body: Parameters<typeof changeNumberSeries>[1] = {};
    if (format.prefix.trim() !== row.prefix) body.prefix = format.prefix.trim();
    if (format.separator !== row.separator) body.separator = format.separator;
    if (format.fyStyle !== row.fyStyle) body.fyStyle = format.fyStyle;
    if (Number(format.width) !== row.width) body.width = Number(format.width);
    if (!row.locked && format.resetRule !== row.resetRule) body.resetRule = format.resetRule;
    if (!row.locked && Number(format.fyStartMonth) !== row.fyStartMonth) {
      body.fyStartMonth = Number(format.fyStartMonth);
    }
    if (Object.keys(body).length === 0) {
      close();
      return;
    }
    busy.current = true;
    setSaving(true);
    setDialogError(null);
    const result = await changeNumberSeries(row.series, body);
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setDialogError(masterErrorMessage(result));
      return;
    }
    put(result.data);
    close();
    setFlash({ kind: 'ok', text: copy.saved });
  }

  async function saveStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !dialog) {
      return;
    }
    const n = Number(startNumber);
    if (!Number.isInteger(n) || n < 1) {
      setDialogError(copy.startInvalid);
      return;
    }
    busy.current = true;
    setSaving(true);
    setDialogError(null);
    const result = await raiseStartNumber(dialog.row.series, { startNumber: n, reason });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setDialogError(masterErrorMessage(result));
      return;
    }
    put(result.data);
    close();
    setFlash({ kind: 'ok', text: copy.startSaved });
  }

  const separatorLabel = (value: string) => copy.separators[value] ?? value;
  const preview = (row: SeriesRow, d: FormatDraft, running: bigint): string =>
    previewNumber({
      prefix: d.prefix.trim(),
      fyStyle: d.fyStyle,
      separator: d.separator,
      width: Number(d.width) || 1,
      today: dateToday,
      fyStartMonth: row.locked ? row.fyStartMonth : Number(d.fyStartMonth) || row.fyStartMonth,
      running,
    });

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {dialog === null && flash ? (
        <p
          role={flash.kind === 'error' ? 'alert' : 'status'}
          className={`type-label ${flash.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
        >
          {flash.text}
        </p>
      ) : null}
      <ul className="staff-cards">
        {rows.map((row) => (
          <li key={row.series} className="settings-doctor" aria-label={copy.names[row.series]}>
            <p className="type-label-strong">{copy.names[row.series]}</p>
            {!row.configured ? (
              <p className="type-small text-muted-foreground">{copy.notConfigured}</p>
            ) : (
              <>
                <div>
                  <p className="type-small text-muted-foreground">{copy.nextLabel}</p>
                  <p className="type-label-strong">{row.next}</p>
                </div>
                <p className="type-small text-muted-foreground">
                  {copy.lastLine.replace('{n}', row.lastNumber)}
                </p>
                <p className="type-small text-muted-foreground">
                  {row.resetRule === 'FINANCIAL_YEAR'
                    ? copy.resetYear.replace('{month}', copy.months[row.fyStartMonth - 1] ?? '')
                    : copy.resetNever}
                </p>
                {row.locked ? (
                  <p className="type-small text-muted-foreground">{copy.lockedNote}</p>
                ) : null}
                {!row.editable ? (
                  <p className="type-small text-muted-foreground">{copy.customNote}</p>
                ) : null}
                <div className="cluster">
                  {row.editable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-haspopup="dialog"
                      aria-label={`${copy.names[row.series]}: ${copy.changeFormat}`}
                      onClick={() => openFormat(row)}
                    >
                      {copy.changeFormat}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-haspopup="dialog"
                    aria-label={`${copy.names[row.series]}: ${copy.setStart}`}
                    onClick={() => openStart(row)}
                  >
                    {copy.setStart}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="type-small text-muted-foreground">{copy.note}</p>

      {dialog?.kind === 'format' && format ? (
        <Modal
          narrow
          title={copy.formatTitle.replace('{name}', copy.names[dialog.row.series] ?? '')}
          onClose={close}
        >
          <form className="section-stack" noValidate onSubmit={(event) => void saveFormat(event)}>
            {dialogError ? (
              <p role="alert" className="type-label text-destructive">
                {dialogError}
              </p>
            ) : null}
            <p className="type-label" role="status">
              {copy.previewLabel}{' '}
              <strong>
                {preview(dialog.row, format, BigInt(dialog.row.lastNumber) + BigInt(1))}
              </strong>
            </p>
            <fieldset disabled={saving} className="section-stack">
              <InputField
                label={copy.prefixLabel}
                hint={copy.prefixHint}
                autoComplete="off"
                maxLength={8}
                value={format.prefix}
                onChange={(event) =>
                  setFormat((d) => (d ? { ...d, prefix: event.target.value } : d))
                }
              />
              <SelectField
                label={copy.fyStyleLabel}
                value={format.fyStyle}
                onChange={(event) =>
                  setFormat((d) =>
                    d ? { ...d, fyStyle: event.target.value as 'SHORT' | 'LONG' } : d,
                  )
                }
              >
                <option value="SHORT">{copy.fyShort}</option>
                <option value="LONG">{copy.fyLong}</option>
              </SelectField>
              <SelectField
                label={copy.separatorLabel}
                value={format.separator}
                onChange={(event) =>
                  setFormat((d) => (d ? { ...d, separator: event.target.value } : d))
                }
              >
                {['', '-', '/', '.', '_'].map((s) => (
                  <option key={s} value={s}>
                    {separatorLabel(s)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={copy.widthLabel}
                hint={copy.widthHint}
                value={format.width}
                onChange={(event) =>
                  setFormat((d) => (d ? { ...d, width: event.target.value } : d))
                }
              >
                {WIDTHS.map((w) => (
                  <option key={w} value={String(w)}>
                    {w}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={copy.resetLabel}
                value={format.resetRule}
                disabled={dialog.row.locked}
                onChange={(event) =>
                  setFormat((d) =>
                    d ? { ...d, resetRule: event.target.value as 'NEVER' | 'FINANCIAL_YEAR' } : d,
                  )
                }
              >
                <option value="FINANCIAL_YEAR">{copy.resetOptionYear}</option>
                <option value="NEVER">{copy.resetOptionNever}</option>
              </SelectField>
              <SelectField
                label={copy.monthLabel}
                value={format.fyStartMonth}
                disabled={dialog.row.locked}
                onChange={(event) =>
                  setFormat((d) => (d ? { ...d, fyStartMonth: event.target.value } : d))
                }
              >
                {copy.months.map((name, index) => (
                  <option key={name} value={String(index + 1)}>
                    {name}
                  </option>
                ))}
              </SelectField>
              {dialog.row.locked ? (
                <p className="type-small text-muted-foreground">{copy.lockedHint}</p>
              ) : null}
            </fieldset>
            <div className="settings-actions">
              <Button type="submit" disabled={saving} className="touch-target">
                {saving ? copy.saving : copy.save}
              </Button>
              <Button type="button" variant="outline" disabled={saving} onClick={close}>
                {copy.cancel}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {dialog?.kind === 'start' ? (
        <Modal
          narrow
          title={copy.startTitle.replace('{name}', copy.names[dialog.row.series] ?? '')}
          onClose={close}
        >
          <form className="section-stack" noValidate onSubmit={(event) => void saveStart(event)}>
            {dialogError ? (
              <p role="alert" className="type-label text-destructive">
                {dialogError}
              </p>
            ) : null}
            <p className="type-small text-muted-foreground">
              {copy.startIntro.replace('{next}', dialog.row.next)}
            </p>
            {Number.isInteger(Number(startNumber)) && Number(startNumber) >= 1 ? (
              <p className="type-label" role="status">
                {copy.previewLabel}{' '}
                <strong>
                  {preview(
                    dialog.row,
                    {
                      prefix: dialog.row.prefix,
                      separator: dialog.row.separator,
                      fyStyle: dialog.row.fyStyle,
                      width: String(dialog.row.width),
                      resetRule: dialog.row.resetRule,
                      fyStartMonth: String(dialog.row.fyStartMonth),
                    },
                    BigInt(startNumber),
                  )}
                </strong>
              </p>
            ) : null}
            <fieldset disabled={saving} className="section-stack">
              <InputField
                label={copy.startLabel}
                inputMode="numeric"
                autoComplete="off"
                value={startNumber}
                onChange={(event) => setStartNumber(event.target.value)}
              />
              <InputField
                label={copy.reasonLabel}
                autoComplete="off"
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </fieldset>
            <div className="settings-actions">
              <Button type="submit" disabled={saving} className="touch-target">
                {saving ? copy.saving : copy.saveStart}
              </Button>
              <Button type="button" variant="outline" disabled={saving} onClick={close}>
                {copy.cancel}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </SettingBlock>
  );
}

export type { SeriesKind };
