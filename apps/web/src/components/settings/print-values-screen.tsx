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
import { errorMessageFor } from '@/lib/patients/client';
import { addPrintValue, changePrintValue, listPrintValues } from '@/lib/print-values/client';
import { printValueErrorMessage } from '@/lib/print-values/errors';
import type { PrintValueRow, PrintValuesManageResponse } from '@/lib/print-values/types';

const copy = staffCopy.printValues;

type Flash = { kind: 'ok' | 'error'; text: string } | null;
type Draft = { key: string; label: string; value: string; scope: 'branch' | 'hospital' };

/**
 * Settings, Hospital, Print values: named plain-text values (for example a helpline number or an
 * accreditation number) that are inserted into a print template from the designer. A value belongs to
 * the whole hospital or to this branch; a branch value replaces the hospital value with the same name
 * for this branch. Values are never deleted, only deactivated. The API checks every rule; text only,
 * no HTML and nothing is calculated.
 */
export function PrintValuesScreen({
  initial,
  initialErrorCode,
}: {
  initial: PrintValuesManageResponse | null;
  initialErrorCode: string | null;
}) {
  const [rows, setRows] = useState<PrintValueRow[]>(initial?.items ?? []);
  const [canChange, setCanChange] = useState(
    initial?.canChange ?? { branch: false, hospital: false },
  );
  const limits = initial?.limits ?? { keyMax: 30, labelMax: 60, valueMax: 200, perScopeMax: 30 };
  const [loadError, setLoadError] = useState<string | null>(
    initial ? null : initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError,
  );
  const [reloading, setReloading] = useState(false);
  const [dialog, setDialog] = useState<PrintValueRow | 'new' | null>(null);
  const defaultScope = canChange.hospital ? 'hospital' : 'branch';
  const [draft, setDraft] = useState<Draft>({
    key: '',
    label: '',
    value: '',
    scope: defaultScope,
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
    const result = await listPrintValues();
    setReloading(false);
    if (result.ok) {
      setRows(result.data.items);
      setCanChange(result.data.canChange);
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

  const mayAdd = canChange.branch || canChange.hospital;
  const mayChangeRow = (row: PrintValueRow) =>
    row.scope === 'HOSPITAL' ? canChange.hospital : canChange.branch;

  function openDialog(row: PrintValueRow | 'new') {
    setDialog(row);
    setDialogError(null);
    setDraft(
      row === 'new'
        ? { key: '', label: '', value: '', scope: defaultScope }
        : { key: row.key, label: row.label, value: row.value, scope: 'hospital' },
    );
  }

  const put = (row: PrintValueRow) => setRows((all) => all.map((r) => (r.id === row.id ? row : r)));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !dialog) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setDialogError(null);
    const result =
      dialog === 'new'
        ? await addPrintValue(
            { key: draft.key.trim(), label: draft.label, value: draft.value },
            draft.scope,
          )
        : await changePrintValue(dialog.id, { label: draft.label, value: draft.value });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setDialogError(printValueErrorMessage(result));
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

  async function toggle(row: PrintValueRow) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setFlash(null);
    const result = await changePrintValue(row.id, { active: !row.active });
    busy.current = false;
    if (!result.ok) {
      setFlash({ kind: 'error', text: printValueErrorMessage(result) });
      return;
    }
    put(result.data);
    setFlash({
      kind: 'ok',
      text: (row.active ? copy.deactivated : copy.activated).replace('{name}', row.label),
    });
  }

  const columns: DataTableColumn<PrintValueRow>[] = [
    {
      id: 'name',
      header: copy.columns.name,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{r.label}</span>
          <span className="type-small text-muted-foreground">{r.field}</span>
        </div>
      ),
    },
    { id: 'text', header: copy.columns.text, cell: (r) => r.value },
    {
      id: 'scope',
      header: copy.columns.scope,
      hideOnPhone: true,
      cell: (r) => (r.scope === 'BRANCH' ? copy.scopeBranch : copy.scopeHospital),
    },
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
      cell: (r) =>
        mayChangeRow(r) ? (
          <div className="cluster">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              aria-label={`${r.label}: ${copy.edit}`}
              onClick={() => openDialog(r)}
            >
              {copy.edit}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${r.label}: ${r.active ? copy.deactivate : copy.activate}`}
              onClick={() => void toggle(r)}
            >
              {r.active ? copy.deactivate : copy.activate}
            </Button>
          </div>
        ) : (
          <span className="type-small text-muted-foreground">{copy.hospitalOnly}</span>
        ),
    },
  ];

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {mayAdd ? (
        <div className="settings-actions">
          <Button type="button" className="touch-target" onClick={() => openDialog('new')}>
            {copy.add}
          </Button>
        </div>
      ) : (
        <p className="type-label text-muted-foreground">{copy.readOnly}</p>
      )}
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
        <DataTable<PrintValueRow>
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
          title={dialog === 'new' ? copy.addTitle : copy.editTitle.replace('{name}', dialog.label)}
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
                  {canChange.branch && canChange.hospital ? (
                    <SelectField
                      label={copy.scopeLabel}
                      hint={copy.scopeHint}
                      value={draft.scope}
                      onChange={(event) =>
                        setDraft((d) => ({
                          ...d,
                          scope: event.target.value as 'branch' | 'hospital',
                        }))
                      }
                    >
                      <option value="hospital">{copy.scopeHospital}</option>
                      <option value="branch">{copy.scopeBranch}</option>
                    </SelectField>
                  ) : (
                    <p className="type-small text-muted-foreground">{copy.onlyBranch}</p>
                  )}
                  <InputField
                    label={copy.keyLabel}
                    hint={copy.keyHint}
                    autoComplete="off"
                    value={draft.key}
                    maxLength={limits.keyMax}
                    onChange={(event) => setDraft((d) => ({ ...d, key: event.target.value }))}
                  />
                </>
              ) : (
                <p className="type-small text-muted-foreground">
                  {copy.keyFixed.replace('{field}', dialog.field)}
                </p>
              )}
              <InputField
                label={copy.labelLabel}
                hint={copy.labelHint}
                autoComplete="off"
                value={draft.label}
                maxLength={limits.labelMax}
                onChange={(event) => setDraft((d) => ({ ...d, label: event.target.value }))}
              />
              <InputField
                label={copy.valueLabel}
                hint={copy.valueHint}
                autoComplete="off"
                value={draft.value}
                maxLength={limits.valueMax}
                onChange={(event) => setDraft((d) => ({ ...d, value: event.target.value }))}
              />
            </fieldset>
            <div className="settings-actions">
              <Button type="submit" disabled={saving} className="touch-target">
                {saving ? copy.saving : copy.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="touch-target"
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
