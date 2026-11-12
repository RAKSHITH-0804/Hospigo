'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { sessionConfig } from '@/config/session';

type LoginTab = 'hospital' | 'hq';
type FormError = 'rate_limited' | 'unavailable' | null;

export default function ForgotPasswordPage() {
  const [tab, setTab] = useState<LoginTab>('hospital');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'hq') {
      setTab('hq');
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAccepted(false);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const accessCode = String(form.get('accessCode') ?? '');
    const path = tab === 'hospital' ? '/api/auth/forgot-password' : '/api/auth/hq-forgot-password';
    const body = tab === 'hospital' ? { accessCode, email } : { email };

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 429) {
        setError('rate_limited');
        return;
      }
      if (response.status === 503 || response.status === 502) {
        setError('unavailable');
        return;
      }
      if (response.status === 202) {
        setAccepted(true);
        return;
      }
      if (!response.ok) {
        setError('unavailable');
        return;
      }
      setAccepted(true);
    } catch {
      setError('unavailable');
    } finally {
      setPending(false);
    }
  }

  const errorText =
    error === 'rate_limited'
      ? sessionConfig.errorRateLimited
      : error === 'unavailable'
        ? sessionConfig.errorUnavailable
        : null;

  return (
    <div className="login-page">
      <section className="login-brand-panel">
        <p className="type-label font-medium tracking-wide">Hospigo</p>
        <div className="login-brand-copy">
          <h1 className="type-title max-w-[var(--size-form-card-max)] font-medium leading-tight">
            Reset your password
          </h1>
          <p className="type-label mt-[var(--space-3)] text-login-brand-foreground/80">
            A product by Indigo
          </p>
        </div>
        <div aria-hidden="true" />
      </section>

      <section className="login-form-panel">
        <div className="login-form-card">
          <div className="cluster-between mb-[var(--space-3)]">
            <h2 className="type-heading font-medium">Forgot password</h2>
          </div>

          <div role="tablist" aria-label="Account type" className="login-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'hospital'}
              className="login-tab"
              disabled={pending}
              onClick={() => {
                setTab('hospital');
                setError(null);
                setAccepted(false);
              }}
            >
              Hospital staff
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'hq'}
              className="login-tab"
              disabled={pending}
              onClick={() => {
                setTab('hq');
                setError(null);
                setAccepted(false);
              }}
            >
              Indigo HQ
            </button>
          </div>

          {accepted ? (
            <p role="status" className="type-label mt-[var(--space-3)] text-muted-foreground">
              {sessionConfig.forgotPasswordConfirmation}
            </p>
          ) : null}

          <form className="login-form" onSubmit={onSubmit} noValidate>
            {tab === 'hospital' ? (
              <label className="field-label">
                Access code
                <input
                  name="accessCode"
                  autoComplete="organization"
                  className="field-input"
                  required
                  disabled={pending}
                />
              </label>
            ) : null}
            <label className="field-label">
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                className="field-input"
                required
                disabled={pending}
              />
            </label>
            {errorText ? (
              <p role="alert" className="type-label text-destructive">
                {errorText}
              </p>
            ) : null}
            <Button type="submit" className="touch-target" disabled={pending}>
              {pending ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>

          <p className="type-label mt-[var(--space-4)]">
            <Link
              href={sessionConfig.loginPath}
              className="text-primary underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
