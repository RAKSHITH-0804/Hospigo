'use client';

import { useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { confirmEmailChange, requestEmailChange } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type { AccountView } from '@/lib/staff/types';

const copy = staffCopy.account.email;

type Step = 'idle' | 'typing' | 'code';

/**
 * Change the email address: type the NEW address, a code is sent there, type the code. The old
 * address keeps working until the code is confirmed, so a typing mistake cannot lock anyone out.
 */
export function EmailChange({
  account,
  onChanged,
}: {
  account: AccountView;
  onChanged: (account: AccountView) => void;
}) {
  const [step, setStep] = useState<Step>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function reset() {
    setStep('idle');
    setEmail('');
    setCode('');
    setMessage(null);
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) {
      return;
    }
    setWorking(true);
    setMessage(null);
    const result = await requestEmailChange(email.trim());
    setWorking(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    setSentTo(email.trim());
    setStep('code');
    setMessage({ kind: 'ok', text: copy.sent.replace('{email}', email.trim()) });
  }

  async function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) {
      return;
    }
    setWorking(true);
    setMessage(null);
    const result = await confirmEmailChange(code.trim());
    setWorking(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    onChanged(result.data);
    setStep('idle');
    setEmail('');
    setCode('');
    setMessage({ kind: 'ok', text: copy.changed });
  }

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      <p className="type-label">
        {copy.current}: <strong className="break-all">{account.email}</strong>
      </p>
      {step === 'idle' ? (
        <div className="settings-actions">
          <Button type="button" variant="outline" onClick={() => setStep('typing')}>
            {copy.change}
          </Button>
        </div>
      ) : null}
      {step === 'typing' ? (
        <form
          onSubmit={(event) => void onSend(event)}
          noValidate
          className="flex flex-col gap-[var(--space-2)]"
        >
          <fieldset disabled={working} className="settings-part">
            <div className="settings-field-medium">
              <InputField
                label={copy.newEmail}
                type="email"
                value={email}
                autoComplete="off"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </fieldset>
          <div className="settings-actions">
            <Button type="submit" disabled={working} className="touch-target">
              {working ? copy.sending : copy.sendCode}
            </Button>
            <Button type="button" variant="outline" disabled={working} onClick={reset}>
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : null}
      {step === 'code' ? (
        <form
          onSubmit={(event) => void onConfirm(event)}
          noValidate
          className="flex flex-col gap-[var(--space-2)]"
        >
          <p className="type-small text-muted-foreground">{sentTo}</p>
          <fieldset disabled={working} className="settings-part">
            <div className="settings-field-narrow">
              <InputField
                label={copy.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
          </fieldset>
          <div className="settings-actions">
            <Button type="submit" disabled={working} className="touch-target">
              {working ? copy.confirming : copy.confirm}
            </Button>
            <Button type="button" variant="outline" disabled={working} onClick={reset}>
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : null}
      <p
        role={message?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${message?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {message?.text ?? ''}
      </p>
    </SettingBlock>
  );
}
