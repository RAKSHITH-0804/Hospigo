'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { sessionConfig } from '@/config/session';
import { staffScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { confirmPasswordChange, requestPasswordChange } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';

const copy = staffCopy.account.password;

type Step = 'idle' | 'email' | 'code' | 'done';

/**
 * Change the password with a code sent to the person's own email address: type the address, type
 * the code, choose the new password twice. The API ends every session after the change, so the
 * screen signs this browser out and goes to the sign-in page with the usual "password updated" note.
 */
export function PasswordChange() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  function reset() {
    setStep('idle');
    setEmail('');
    setCode('');
    setPassword('');
    setRepeat('');
    setMessage(null);
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) {
      return;
    }
    setWorking(true);
    setMessage(null);
    const result = await requestPasswordChange(email.trim());
    setWorking(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    setStep('code');
    setMessage({ kind: 'ok', text: copy.sent });
  }

  async function onChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) {
      return;
    }
    if (password !== repeat) {
      setMessage({ kind: 'error', text: copy.mismatch });
      return;
    }
    setWorking(true);
    setMessage(null);
    const result = await confirmPasswordChange(code.trim(), password);
    setWorking(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    setPassword('');
    setRepeat('');
    setStep('done');
    setMessage({ kind: 'ok', text: copy.changed });
    timer.current = setTimeout(() => {
      void (async () => {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
        } catch {
          // Every session is already ended by the API; go to sign-in anyway.
        }
        router.replace(
          `${sessionConfig.loginPath}?notice=${encodeURIComponent(sessionConfig.passwordUpdatedNotice)}`,
        );
        router.refresh();
      })();
    }, staffScreenConfig.signOutDelayMs);
  }

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {step === 'idle' ? (
        <div className="settings-actions">
          <Button type="button" variant="outline" onClick={() => setStep('email')}>
            {copy.start}
          </Button>
        </div>
      ) : null}
      {step === 'email' ? (
        <form
          onSubmit={(event) => void onSend(event)}
          noValidate
          className="flex flex-col gap-[var(--space-2)]"
        >
          <fieldset disabled={working} className="settings-part">
            <div className="settings-field-medium">
              <InputField
                label={copy.email}
                type="email"
                value={email}
                autoComplete="email"
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
          onSubmit={(event) => void onChange(event)}
          noValidate
          className="flex flex-col gap-[var(--space-2)]"
        >
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
            <div className="settings-field-medium">
              <InputField
                label={copy.newPassword}
                hint={copy.newPasswordHint}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="settings-field-medium">
              <InputField
                label={copy.repeat}
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
              />
            </div>
          </fieldset>
          <div className="settings-actions">
            <Button type="submit" disabled={working} className="touch-target">
              {working ? copy.changing : copy.change}
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
