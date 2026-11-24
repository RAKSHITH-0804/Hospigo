'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { InputField, SelectField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import {
  addVitalsField,
  changeVitalsField,
  listVitalsFields,
  reorderVitalsFields,
} from '@/lib/masters/client';
import { masterErrorMessage } from '@/lib/masters/errors';
import type { VitalsFieldRow, VitalsFieldsResponse } from '@/lib/masters/types';
import { errorMessageFor } from '@/lib/patients/client';

const copy = staffCopy.masters.vitals;

type Flash = { kind: 'ok' | 'error'; text: string } | null;
type Draft = {
  code: string;
  name: string;
  unit: string;
  valueKind: 'NUMBER' | 'TEXT';
  warnMin: string;
  warnMax: string;
};

/** A typed limit: empty means none; anything else must be a number. */
function limitOf(text: string): number | null | 'BAD' {
  const t = text.trim();
  if (t === '') {
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 'BAD';
}

const rangeText = (r: VitalsFieldRow): string =>
  r.warnMin === null && r.warnMax === null
    ? copy.noRange
    : copy.rangeText
        .replace('{min}', r.warnMin === null ? '…' : String(r.warnMin))
        .replace('{max}', r.warnMax === null ? '…' : String(r.warnMax));

/**
 * Settings, OPD, Vitals fields: add a field, change its name, unit and usual range, put the fields in
 * order, switch one off and on. The range only makes the nurse screen WARN; it never blocks a
 * reading. A field is never deleted; its code and kind (number or text) never change.
 */
export function VitalsFieldsScreen({
  initial,
  initialErrorCode,
}: {
  initial: VitalsFieldsResponse | null;
  initialErrorCode: string | null;
}) {
  const [rows, setRows] = useState<VitalsFieldRow[]>(initial?.items ?? []);
  const [loadError, setLoadError] = useState<string | null>(
    initial ? null : initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError,
  );
  const [reloading, setReloading] = useState(false);
  const [dialog, setDialog] = useState<VitalsFieldRow | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>({
    code: '',
    name: '',
    unit: '',
    valueKind: 'NUMBER',
    warnMin: '',
    warnMax: '',
  });
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
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
    const result = await listVitalsFields();
    setReloading(false);
    if (result.ok) {
      setRows(result.data.items);
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

  function openDialog(field: VitalsFieldRow | 'new') {
    setDialog(field);
    setDialogError(null);
    setDraft(
      field === 'new'
        ? { code: '', name: '', unit: '', valueKind: 'NUMBER', warnMin: '', warnMax: '' }
        : {
            code: field.code,
            name: field.name,
            unit: field.unit,
            valueKind: field.valueKind,
            warnMin: field.warnMin === null ? '' : String(field.warnMin),
            warnMax: field.warnMax === null ? '' : String(field.warnMax),
          },
    );
  }

  const put = (row: VitalsFieldRow) =>
    setRows((all) => all.map((r) => (r.id === row.id ? row : r)));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !dialog) {
      return;
    }
    const isText = draft.valueKind === 'TEXT';
    const warnMin = isText ? null : limitOf(draft.warnMin);
    const warnMax = isText ? null : limitOf(draft.warnMax);
    if (warnMin === 'BAD' || warnMax === 'BAD') {
      setDialogError(copy.errorNotANumber);
      return;
    }
    busy.current = true;
    setSaving(true);
    setDialogError(null);
    const result =
      dialog === 'new'
        ? await addVitalsField({
            code: draft.code,
            name: draft.name,
            unit: draft.unit,
            valueKind: draft.valueKind,
            warnMin,
            warnMax,
          })
        : await changeVitalsField(dialog.id, {
            name: draft.name,
            unit: draft.unit,
            ...(dialog.valueKind === 'NUMBER' ? { warnMin, warnMax } : {}),
          });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setDialogError(masterErrorMessage(result));
      return;
    }
    if (dialog === 'new') {
      setRows((all) => [...all, result.data]);
    } else {
      put(result.data);
    }
    setDialog(null);
    setFlash({ kind: 'ok', text: dialog === 'new' ? copy.added : copy.saved });
  }

  async function toggle(row: VitalsFieldRow) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setFlash(null);
    const result = await changeVitalsField(row.id, { active: !row.active });
    busy.current = false;
    if (!result.ok) {
      setFlash({ kind: 'error', text: masterErrorMessage(result) });
      return;
    }
    put(result.data);
    setFlash({
      kind: 'ok',
      text: (row.active ? copy.deactivated : copy.activated).replace('{name}', row.name),
    });
  }

  async function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (busy.current || target < 0 || target >= rows.length) {
      return;
    }
    const ids = rows.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    busy.current = true;
    setFlash(null);
    const result = await reorderVitalsFields(ids);
    busy.current = false;
    if (!result.ok) {
      setFlash({ kind: 'error', text: masterErrorMessage(result) });
      return;
    }
    setRows(result.data.items);
  }

  const columns: DataTableColumn<VitalsFieldRow>[] = [
    {
      id: 'name',
      header: copy.columns.name,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{r.name}</span>
          <span className="type-small text-muted-foreground">{r.code}</span>
        </div>
      ),
    },
    { id: 'unit', header: copy.columns.unit, cell: (r) => r.unit, nowrap: true },
    {
      id: 'kind',
      header: copy.columns.kind,
      hideOnPhone: true,
      cell: (r) => (r.valueKind === 'NUMBER' ? copy.kindNumber : copy.kindText),
    },
    { id: 'range', header: copy.columns.range, cell: (r) => rangeText(r), nowrap: true },
    {
      id: 'status',
      header: copy.columns.status,
      cell: (r) => (
        <Badge variant={r.active ? 'success' : 'neutral'}>
          {r.active ? copy.statusActive : copy.statusInactive}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (r) => {
        const index = rows.findIndex((x) => x.id === r.id);
        return (
          <div className="cluster">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${r.name}: ${copy.moveUp}`}
              disabled={index === 0}
              onClick={() => void move(index, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${r.name}: ${copy.moveDown}`}
              disabled={index === rows.length - 1}
              onClick={() => void move(index, 1)}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              aria-label={`${r.name}: ${copy.edit}`}
              onClick={() => openDialog(r)}
            >
              {copy.edit}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${r.name}: ${r.active ? copy.deactivate : copy.activate}`}
              onClick={() => void toggle(r)}
            >
              {r.active ? copy.deactivate : copy.activate}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      <div className="settings-actions">
        <Button type="button" className="touch-target" onClick={() => openDialog('new')}>
          {copy.add}
        </Button>
      </div>
      {dialog === null && flash ? (
        <p
          role={flash.kind === 'error' ? 'alert' : 'status'}
          className={`type-label ${flash.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
        >
          {flash.text}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <DataTable<VitalsFieldRow>
          ariaLabel={copy.title}
          columns={columns}
          rows={rows}
          stackOnPhone
        />
      )}
      <p className="type-small text-muted-foreground">{copy.note}</p>

      {dialog ? (
        <Modal
          narrow
          title={dialog === 'new' ? copy.addTitle : copy.editTitle.replace('{name}', dialog.name)}
          onClose={() => setDialog(null)}
        >
          <form className="section-stack" noValidate onSubmit={(event) => void onSubmit(event)}>
            {dialogError ? (
              <p role="alert" className="type-label text-destructive">
                {dialogError}
              </p>
            ) : null}
            <fieldset disabled={saving} className="section-stack">
              {dialog === 'new' ? (
                <>
                  <InputField
                    label={copy.codeLabel}
                    hint={copy.codeHint}
                    autoComplete="off"
                    value={draft.code}
                    maxLength={30}
                    onChange={(event) => setDraft((d) => ({ ...d, code: event.target.value }))}
                  />
                  <SelectField
                    label={copy.kindLabel}
                    value={draft.valueKind}
                    onChange={(event) =>
                      setDraft((d) => ({
                        ...d,
                        valueKind: event.target.value as 'NUMBER' | 'TEXT',
                      }))
                    }
                  >
                    <option value="NUMBER">{copy.kindNumber}</option>
                    <option value="TEXT">{copy.kindText}</option>
                  </SelectField>
                </>
              ) : (
                <p className="type-small text-muted-foreground">
                  {copy.codeFixed
                    .replace('{code}', dialog.code)
                    .replace(
                      '{kind}',
                      dialog.valueKind === 'NUMBER' ? copy.kindNumber : copy.kindText,
                    )}
                </p>
              )}
              <InputField
                label={copy.nameLabel}
                autoComplete="off"
                value={draft.name}
                maxLength={40}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              />
              <InputField
                label={copy.unitLabel}
                autoComplete="off"
                value={draft.unit}
                maxLength={12}
                onChange={(event) => setDraft((d) => ({ ...d, unit: event.target.value }))}
              />
              {draft.valueKind === 'NUMBER' ? (
                <div className="cluster-top">
                  <InputField
                    label={copy.warnMinLabel}
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.warnMin}
                    onChange={(event) => setDraft((d) => ({ ...d, warnMin: event.target.value }))}
                  />
                  <InputField
                    label={copy.warnMaxLabel}
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.warnMax}
                    onChange={(event) => setDraft((d) => ({ ...d, warnMax: event.target.value }))}
                  />
                </div>
              ) : null}
              {draft.valueKind === 'NUMBER' ? (
                <p className="type-small text-muted-foreground">{copy.warnHint}</p>
              ) : null}
            </fieldset>
            <div className="settings-actions">
              <Button type="submit" disabled={saving} className="touch-target">
                {saving ? copy.saving : copy.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                {copy.cancel}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </SettingBlock>
  );
}
