'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { saveAccount } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type { AccountView } from '@/lib/staff/types';

const copy = staffCopy.account.details;

/** Name and phone: every signed-in person changes their own. Code, branches and roles are shown only. */
export function AccountDetails({
  account,
  onChanged,
}: {
  account: AccountView;
  onChanged: (account: AccountView) => void;
}) {
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone ?? '');
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setMessage(null);
    const result = await saveAccount({ name, phone });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    onChanged(result.data);
    setName(result.data.name);
    setPhone(result.data.phone ?? '');
    setMessage({ kind: 'ok', text: copy.saved });
  }

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      <dl className="settings-doctor-details">
        <div>
          <dt className="type-small text-muted-foreground">{copy.code}</dt>
          <dd className="type-label">{account.code}</dd>
        </div>
        <div>
          <dt className="type-small text-muted-foreground">{copy.branches}</dt>
          <dd className="type-label">{account.branches.join(', ') || copy.none}</dd>
        </div>
        <div>
          <dt className="type-small text-muted-foreground">{copy.roles}</dt>
          <dd className="type-label">{account.roles.join(', ') || copy.none}</dd>
        </div>
      </dl>
      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="flex flex-col gap-[var(--space-2)]"
      >
        <fieldset disabled={saving} className="settings-part">
          <div className="settings-field-medium">
            <InputField
              label={copy.name}
              value={name}
              maxLength={account.limits.nameMax}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="settings-field-narrow">
            <InputField
              label={copy.phone}
              type="tel"
              value={phone}
              maxLength={account.limits.phoneMax}
              autoComplete="tel"
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </fieldset>
        <p
          role={message?.kind === 'error' ? 'alert' : 'status'}
          className={`settings-flash settings-flash-lazy type-label ${message?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
        >
          {message?.text ?? ''}
        </p>
        <div className="settings-actions">
          <Button type="submit" disabled={saving} className="touch-target">
            {saving ? copy.saving : copy.save}
          </Button>
        </div>
      </form>
    </SettingBlock>
  );
}
