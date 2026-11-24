'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { InputField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { addPaymentMode, changePaymentMode, listPaymentModes } from '@/lib/masters/client';
import { masterErrorMessage } from '@/lib/masters/errors';
import type { PaymentModeRow, PaymentModesResponse } from '@/lib/masters/types';
import { errorMessageFor } from '@/lib/patients/client';

const copy = staffCopy.masters.paymentModes;

type Flash = { kind: 'ok' | 'error'; text: string } | null;
type Draft = { code: string; name: string; requiresReference: boolean };

const sorted = (rows: PaymentModeRow[]): PaymentModeRow[] =>
  [...rows].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

/**
 * Settings, Billing, Payment modes: add a mode, rename it, say whether a reference must be typed,
 * switch it off and on. A mode is never deleted and its code never changes. The API checks every
 * rule; the reference rule itself is applied when a payment is taken.
 */
export function PaymentModesScreen({
  initial,
  initialErrorCode,
}: {
  initial: PaymentModesResponse | null;
  initialErrorCode: string | null;
}) {
  const [rows, setRows] = useState<PaymentModeRow[]>(sorted(initial?.items ?? []));
  const [loadError, setLoadError] = useState<string | null>(
    initial ? null : initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError,
  );
  const [reloading, setReloading] = useState(false);
  const [dialog, setDialog] = useState<PaymentModeRow | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>({ code: '', name: '', requiresReference: false });
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
    const result = await listPaymentModes();
    setReloading(false);
    if (result.ok) {
      setRows(sorted(result.data.items));
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

  function openDialog(mode: PaymentModeRow | 'new') {
    setDialog(mode);
    setDialogError(null);
    setDraft(
      mode === 'new'
        ? { code: '', name: '', requiresReference: false }
        : { code: mode.code, name: mode.name, requiresReference: mode.requiresReference },
    );
  }

  function put(row: PaymentModeRow) {
    setRows((all) => sorted(all.map((r) => (r.id === row.id ? row : r))));
  }

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
        ? await addPaymentMode({
            code: draft.code,
            name: draft.name,
            requiresReference: draft.requiresReference,
          })
        : await changePaymentMode(dialog.id, {
            name: draft.name,
            requiresReference: draft.requiresReference,
          });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setDialogError(masterErrorMessage(result));
      return;
    }
    if (dialog === 'new') {
      setRows((all) => sorted([...all, result.data]));
    } else {
      put(result.data);
    }
    setDialog(null);
    setFlash({ kind: 'ok', text: dialog === 'new' ? copy.added : copy.saved });
  }

  async function toggle(row: PaymentModeRow) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setFlash(null);
    const result = await changePaymentMode(row.id, { active: !row.active });
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

  const columns: DataTableColumn<PaymentModeRow>[] = [
    {
      id: 'name',
      header: copy.columns.name,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="type-label-strong">{r.name}</span>
          <span className="type-small text-muted-foreground">
            {r.code}
            {r.isDefault ? ` · ${copy.defaultTag}` : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'reference',
      header: copy.columns.reference,
      cell: (r) => (r.requiresReference ? copy.referenceYes : copy.referenceNo),
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
      id: 'used',
      header: copy.columns.used,
      hideOnPhone: true,
      nowrap: true,
      cell: (r) => copy.usedCount.replace('{n}', String(r.paymentsCount)),
    },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <div className="cluster">
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
          {r.active && r.isDefault ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${r.name}: ${r.active ? copy.deactivate : copy.activate}`}
              onClick={() => void toggle(r)}
            >
              {r.active ? copy.deactivate : copy.activate}
            </Button>
          )}
        </div>
      ),
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
        <DataTable<PaymentModeRow>
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
                <InputField
                  label={copy.codeLabel}
                  hint={copy.codeHint}
                  autoComplete="off"
                  value={draft.code}
                  maxLength={20}
                  onChange={(event) => setDraft((d) => ({ ...d, code: event.target.value }))}
                />
              ) : (
                <p className="type-small text-muted-foreground">
                  {copy.codeFixed.replace('{code}', dialog.code)}
                </p>
              )}
              <InputField
                label={copy.nameLabel}
                autoComplete="off"
                value={draft.name}
                maxLength={40}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              />
              <label className="settings-check settings-check-inline">
                <input
                  type="checkbox"
                  checked={draft.requiresReference}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, requiresReference: event.target.checked }))
                  }
                />
                <span className="type-label">{copy.referenceLabel}</span>
              </label>
              <p className="type-small text-muted-foreground">{copy.referenceHint}</p>
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
