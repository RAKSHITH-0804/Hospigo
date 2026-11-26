'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.auth;

type FormError = 'invalid' | 'rate_limited' | 'unavailable' | null;

export default function LoginPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('notice');
    if (flag === sessionConfig.passwordUpdatedNotice) {
      setNotice(sessionConfig.passwordUpdatedNoticeText);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const accessCode = String(form.get('accessCode') ?? '');

    // One form: a blank access code is an Indigo person, an access code is a hospital user.
    const indigo = accessCode.trim() === '';
    const path = indigo ? '/api/auth/hq-login' : '/api/auth/hospital-login';
    const body = indigo ? { email, password } : { accessCode, email, password };

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
      router.replace(indigo ? sessionConfig.homeHq : sessionConfig.homeHospital);
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

  const forgotHref = sessionConfig.forgotPasswordPath;

  return (
    <div className="login-page">
      <section className="login-brand-panel">
        <p className="type-label font-medium tracking-wide">Hospigo</p>
        <div className="login-brand-copy">
          <h1 className="type-title max-w-[var(--size-form-card-max)] font-medium leading-tight">
            {copy.brandTagline}
          </h1>
          <p className="type-label mt-[var(--space-3)] text-login-brand-foreground/80">
            {copy.product}
          </p>
        </div>
        <div aria-hidden="true" />
      </section>

      <section className="login-form-panel">
        <div className="login-form-card">
          <div className="cluster-between mb-[var(--space-3)]">
            <h2 className="type-heading font-medium">{copy.signIn}</h2>
          </div>

          {notice ? (
            <p role="status" className="type-label mb-[var(--space-3)] text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <form className="login-form" onSubmit={onSubmit} noValidate>
            <label className="field-label">
              {copy.accessCode}
              <input
                name="accessCode"
                autoComplete="organization"
                className="field-input"
                disabled={pending}
              />
            </label>
            <label className="field-label">
              {copy.email}
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
              {copy.password}
              <PasswordInput
                name="password"

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
              {pending ? copy.signingIn : copy.signIn}
            </Button>
          </form>

          <p className="type-label mt-[var(--space-3)]">
            <Link href={forgotHref} className="text-primary underline-offset-4 hover:underline">
              {copy.forgotLink}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
