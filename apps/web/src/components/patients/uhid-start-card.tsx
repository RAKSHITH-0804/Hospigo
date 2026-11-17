'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { SettingBlock } from '@/components/settings/setting-block';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { UHID_START_NUMBER_API, errorMessageFor, patientsApi } from '@/lib/patients/client';
import type { UhidStartNumberResponse } from '@/lib/patients/types';

const copy = staffCopy.settings.uhid;

type Phase = 'ready' | 'error';

export function UhidStartCard({
  canWrite,
  initialInfo,
  initialErrorCode,
}: {
  canWrite: boolean;
  /** First-paint data fetched on the server by the page. */
  initialInfo: UhidStartNumberResponse | null;
  initialErrorCode: string | null;
}) {
  const [phase, setPhase] = useState<Phase>(initialInfo ? 'ready' : 'error');
  const [loadError, setLoadError] = useState<string | null>(
    initialErrorCode ? errorMessageFor(initialErrorCode) : null,
  );
  const [info, setInfo] = useState<UhidStartNumberResponse | null>(initialInfo);
  const [newNumber, setNewNumber] = useState('');
  const [reason, setReason] = useState('');
  const [numberError, setNumberError] = useState<string | undefined>(undefined);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await patientsApi<UhidStartNumberResponse>(UHID_START_NUMBER_API);
    if (!result.ok) {
      setLoadError(errorMessageFor(result.code));
      setPhase('error');
      return;
    }
    setInfo(result.data);
    setPhase('ready');
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!info) {
      return;
    }
    setSuccess(false);
    setFormError(null);
    const trimmedReason = reason.trim();
    const parsed = Number(newNumber);
    let invalid = false;
    if (!newNumber.trim() || !Number.isInteger(parsed)) {
      setNumberError(staffCopy.patients.form.required);
      invalid = true;
    } else if (parsed < info.nextNumber) {
      setNumberError(copy.raiseOnlyError);
      invalid = true;
    } else {
      setNumberError(undefined);
    }
    if (!trimmedReason) {
      setReasonError(staffCopy.patients.form.required);
      invalid = true;
    } else {
      setReasonError(undefined);
    }
    if (invalid) {
      return;
    }

    setSaving(true);
    const result = await patientsApi<{ ok: true }>(UHID_START_NUMBER_API, {
      method: 'PUT',
      body: { startNumber: parsed, reason: trimmedReason },
    });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.status === 400 ? copy.raiseOnlyError : errorMessageFor(result.code));
      return;
    }
    setSuccess(true);
    setNewNumber('');
    setReason('');
    await load();
  }

  return (
    <SettingBlock title={copy.title} description={copy.explanation}>
      {phase === 'error' ? (
        <p role="alert" className="type-label text-destructive">
          {loadError ?? copy.loadError}
        </p>
      ) : null}
      {phase === 'ready' && info ? (
        <>
          <dl className="settings-values">
            <div>
              <dt className="type-small text-muted-foreground">{copy.currentLabel}</dt>
              <dd className="type-body text-foreground">{info.nextNumber}</dd>
            </div>
            <div>
              <dt className="type-small text-muted-foreground">{copy.previewLabel}</dt>
              <dd className="type-body text-foreground">{info.nextUhidPreview}</dd>
            </div>
          </dl>
          {info.periodLabel ? (
            <p className="type-small text-muted-foreground">
              {copy.periodLine.replace('{period}', info.periodLabel)}
            </p>
          ) : null}
          {success ? (
            <p role="status" className="type-label text-foreground">
              {copy.success}
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="type-label text-destructive">
              {formError}
            </p>
          ) : null}
          {canWrite ? (
            <form
              onSubmit={(event) => void onSubmit(event)}
              noValidate
              className="settings-inline-form"
            >
              <div className="settings-field-narrow">
                <InputField
                  label={copy.newNumberLabel}
                  type="number"
                  inputMode="numeric"
                  min={info.nextNumber}
                  step={1}
                  value={newNumber}
                  onChange={(event) => {
                    setNewNumber(event.target.value);
                    setNumberError(undefined);
                  }}
                  error={numberError}
                />
              </div>
              <div className="settings-field-medium">
                <InputField
                  label={copy.reasonLabel}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(undefined);
                  }}
                  error={reasonError}
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={saving} className="touch-target">
                {saving ? copy.saving : copy.save}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </SettingBlock>
  );
}
