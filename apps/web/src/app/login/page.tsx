'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { sessionConfig } from '@/config/session';

type LoginTab = 'hospital' | 'hq';
type FormError = 'invalid' | 'rate_limited' | 'unavailable' | null;

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<LoginTab>('hospital');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const accessCode = String(form.get('accessCode') ?? '');

    const path = tab === 'hospital' ? '/api/auth/hospital-login' : '/api/auth/hq-login';
    const body = tab === 'hospital' ? { accessCode, email, password } : { email, password };

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        setError('invalid');
        return;
      }
      if (response.status === 429) {
        setError('rate_limited');
        return;
      }
      if (response.status === 503) {
        setError('unavailable');
        return;
      }
      if (!response.ok) {
        setError('unavailable');
        return;
      }
      const data = (await response.json()) as { mustChangePassword?: boolean };
      if (data.mustChangePassword) {
        router.replace(sessionConfig.changePasswordPath);
        router.refresh();
        return;
      }
      router.replace(tab === 'hq' ? sessionConfig.homeHq : sessionConfig.homeHospital);
      router.refresh();
    } catch {
      setError('unavailable');
    } finally {
      setPending(false);
    }
  }

  const errorText =
    error === 'invalid'
      ? sessionConfig.errorInvalidCredentials
      : error === 'rate_limited'
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
            One platform. Every hospital.
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
            <h2 className="type-heading font-medium">Sign in</h2>
          </div>

          <div role="tablist" aria-label="Sign-in type" className="login-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'hospital'}
              className="login-tab"
              disabled={pending}
              onClick={() => {
                setTab('hospital');
                setError(null);
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
              }}
            >
              Indigo HQ
            </button>
          </div>

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
            <label className="field-label">
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
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
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
