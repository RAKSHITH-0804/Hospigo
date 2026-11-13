'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { sessionConfig } from '@/config/session';

type FormError = 'mismatch' | 'invalid' | 'rate_limited' | 'unavailable' | 'rules' | null;

export default function ChangePasswordPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>(null);

  async function submitForm(form: HTMLFormElement) {
    setError(null);
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');
    if (newPassword !== confirm) {
      setError('mismatch');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      if (response.status === 401 || payload?.code === 'INVALID_CREDENTIALS') {
        setError('invalid');
        return;
      }
      if (response.status === 429 || payload?.code === 'RATE_LIMITED') {
        setError('rate_limited');
        return;
      }
      if (response.status === 400 || payload?.code === 'VALIDATION') {
        setError('rules');
        return;
      }
      if (
        response.status === 503 ||
        response.status === 502 ||
        payload?.code === 'UNAVAILABLE' ||
        !response.ok
      ) {
        setError('unavailable');
        return;
      }
      router.replace(sessionConfig.homeHospital);
      router.refresh();
    } catch {
      setError('unavailable');
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm(event.currentTarget);
  }

  function onRetry() {
    const form = formRef.current;
    if (form) {
      void submitForm(form);
    }
  }

  const alertText =
    error === 'mismatch'
      ? 'New password and confirmation do not match.'
      : error === 'invalid'
        ? sessionConfig.errorChangePasswordInvalid
        : error === 'rate_limited'
          ? sessionConfig.errorChangePasswordRateLimited
          : error === 'rules'
            ? sessionConfig.errorChangePasswordValidation
            : error === 'unavailable'
              ? sessionConfig.errorChangePasswordUnavailable
              : null;

  return (
    <div className="viewport-fill bg-background">
      <div className="mx-auto flex min-h-[100dvh] max-w-[var(--size-form-card-max)] flex-col justify-center p-[var(--space-page-x)]">
        <h1 className="type-heading font-medium">Change password</h1>
        <p className="type-label mt-[var(--space-2)] text-muted-foreground">
          Choose a new password to continue.
        </p>
        {alertText ? (
          <p role="alert" className="type-label mt-[var(--space-3)] text-destructive">
            {alertText}
          </p>
        ) : null}
        <form
          ref={formRef}
          className="login-form mt-[var(--space-4)]"
          onSubmit={onSubmit}
          noValidate
        >
          <label className="field-label">
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              className="field-input"
              required
              disabled={pending}
            />
          </label>
          <label className="field-label">
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              className="field-input"
              required
              disabled={pending}
            />
          </label>
          <label className="field-label">
            Confirm new password
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              className="field-input"
              required
              disabled={pending}
            />
          </label>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            <Button type="submit" className="touch-target" disabled={pending}>
              {pending ? 'Saving…' : 'Update password'}
            </Button>
            {error === 'unavailable' ? (
              <Button
                type="button"
                variant="outline"
                className="touch-target"
                disabled={pending}
                onClick={onRetry}
              >
                Retry
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
