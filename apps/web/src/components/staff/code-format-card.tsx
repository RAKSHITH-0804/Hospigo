'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor } from '@/lib/patients/client';
import { saveCodeFormat } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type { StaffCodeFormat } from '@/lib/staff/types';

const copy = staffCopy.staffAdmin.codeFormat;

/**
 * How the code of each new staff member is made (start letters and least number of digits).
 * Only a hospital-wide Admin may change it: the API refuses anyone else. Codes already given
 * never change.
 */
export function CodeFormatCard({
  initial,
  initialErrorCode,
  canWrite,
}: {
  initial: StaffCodeFormat | null;
  initialErrorCode: string | null;
  canWrite: boolean;
}) {
  const [format, setFormat] = useState(initial);
  const [prefix, setPrefix] = useState(initial?.prefix ?? '');
  const [minWidth, setMinWidth] = useState(String(initial?.minWidth ?? ''));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (message?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setMessage(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [message]);

  if (!format) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }
  const { limits } = format;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setMessage(null);
    const result = await saveCodeFormat({ prefix, minWidth: Number(minWidth) });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    setFormat(result.data);
    setPrefix(result.data.prefix);
    setMinWidth(String(result.data.minWidth));
    setMessage({ kind: 'ok', text: copy.saved });
  }

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {canWrite ? (
        <form
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="staff-strip"
          aria-label={copy.title}
        >
          <div className="settings-field-narrow">
            <InputField
              label={copy.prefix}
              title={copy.prefixHint}
              value={prefix}
              maxLength={limits.prefixMax}
              autoComplete="off"
              disabled={saving}
              onChange={(event) => setPrefix(event.target.value)}
            />
          </div>
          <div className="settings-field-narrow">
            <InputField
              label={copy.minWidth}
              title={copy.minWidthHint}
              type="number"
              inputMode="numeric"
              min={limits.minWidthMin}
              max={limits.minWidthMax}
              value={minWidth}
              disabled={saving}
              onChange={(event) => setMinWidth(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving} className="touch-target">
            {saving ? copy.saving : copy.save}
          </Button>
          <p className="type-label">
            {copy.next}: <span className="settings-sample">{format.next}</span>
          </p>
        </form>
      ) : (
        <p className="type-label">
          {copy.next}: <span className="settings-sample">{format.next}</span>
        </p>
      )}
      <p
        role={message?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${message?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {message?.text ?? ''}
      </p>
      <p className="type-small text-muted-foreground">{copy.note}</p>
    </SettingBlock>
  );
}
