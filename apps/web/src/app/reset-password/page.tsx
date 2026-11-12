'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { sessionConfig } from '@/config/session';
import { takeActionTokenFromHash } from '@/lib/auth/action-token-hash';

type FormError = 'mismatch' | 'invalid_link' | 'validation' | 'rate_limited' | 'unavailable' | null;

export default function ResetPasswordPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const tokenRef = useRef<string | null>(null);
  const capturedRef = useRef(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>(null);

  useEffect(() => {
    // Strict Mode may run this effect twice; capture only once per mount instance.
    // takeActionTokenFromHash is also module-idempotent across remounts.
    if (capturedRef.current) {
      return;
    }
    capturedRef.current = true;
    const token = takeActionTokenFromHash();
    tokenRef.current = token;
    setHasToken(Boolean(token));
    setTokenReady(true);
  }, []);

  async function submitForm(form: HTMLFormElement) {
    setError(null);
    const token = tokenRef.current;
    if (!token) {
      setError('invalid_link');
      return;
    }
    const data = new FormData(form);
    const newPassword = String(data.get('newPassword') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');
    if (newPassword !== confirm) {
      setError('mismatch');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (response.status === 204) {
        router.replace(
          `${sessionConfig.loginPath}?notice=${encodeURIComponent(sessionConfig.passwordUpdatedNotice)}`,
        );
        return;
      }
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      if (response.status === 400 && payload?.code === 'INVALID_LINK') {
        setError('invalid_link');
        return;
      }
      if (response.status === 400 || payload?.code === 'VALIDATION') {
        setError('validation');
        return;
      }
      if (response.status === 429 || payload?.code === 'RATE_LIMITED') {
        setError('rate_limited');
        return;
      }
      setError('unavailable');
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
      : error === 'invalid_link'
        ? sessionConfig.errorInvalidLink
        : error === 'validation'
          ? sessionConfig.errorPasswordValidation
          : error === 'rate_limited'
            ? sessionConfig.errorRateLimited
            : error === 'unavailable'
              ? sessionConfig.errorUnavailable
              : null;

  if (!tokenReady) {
    return (
      <div className="viewport-fill bg-background p-[var(--space-page-x)] type-label text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!hasToken || error === 'invalid_link') {
    return (
      <div className="viewport-fill bg-background">
        <div className="mx-auto flex min-h-[100dvh] max-w-[var(--size-form-card-max)] flex-col justify-center p-[var(--space-page-x)]">
          <h1 className="type-heading font-medium">Reset password</h1>
          <p role="alert" className="type-label mt-[var(--space-3)] text-destructive">
            {sessionConfig.errorInvalidLink}
          </p>
          <p className="type-label mt-[var(--space-4)]">
            <Link
              href={sessionConfig.forgotPasswordPath}
              className="text-primary underline-offset-4 hover:underline"
            >
              Request a new link
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="viewport-fill bg-background">
      <div className="mx-auto flex min-h-[100dvh] max-w-[var(--size-form-card-max)] flex-col justify-center p-[var(--space-page-x)]">
        <h1 className="type-heading font-medium">Reset password</h1>
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
