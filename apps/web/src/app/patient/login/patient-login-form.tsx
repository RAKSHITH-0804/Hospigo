'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { sessionConfig } from '@/config/session';
import { maskPhoneForDisplay } from '@/lib/auth/phone-display';

type Step = 'phone' | 'code';
type FormError = 'invalid_phone' | 'invalid_code' | 'rate_limited' | 'unavailable' | null;

export function PatientLoginForm() {
  const router = useRouter();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>(null);
  const [resendAfterSec, setResendAfterSec] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('notice') === 'signed-out') {
      setSignedOutNotice(sessionConfig.patientSignedOutNotice);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (step === 'code') {
      codeInputRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (resendAfterSec <= 0) {
      return;
    }
    const id = setTimeout(() => setResendAfterSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [resendAfterSec]);

  const errorText =
    error === 'invalid_phone'
      ? sessionConfig.patientErrorInvalidPhone
      : error === 'invalid_code'
        ? sessionConfig.patientErrorInvalidCode
        : error === 'rate_limited'
          ? sessionConfig.patientErrorRateLimited
          : error === 'unavailable'
            ? sessionConfig.patientErrorUnavailable
            : null;

  const countdownLabel = sessionConfig.patientResendCountdownLabel.replace(
    '{sec}',
    String(resendAfterSec),
  );

  function mapStatus(status: number): FormError {
    if (status === 400) {
      return step === 'phone' ? 'invalid_phone' : 'invalid_code';
    }
    if (status === 401) {
      return 'invalid_code';
    }
    if (status === 429) {
      return 'rate_limited';
    }
    return 'unavailable';
  }

  async function requestOtp(phoneValue: string): Promise<boolean> {
    const response = await fetch('/api/patient-auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneValue }),
    });
    if (!response.ok) {
      setError(mapStatus(response.status));
      return false;
    }
    const data = (await response.json()) as { resendAfterSec?: number };
    const sec =
      typeof data.resendAfterSec === 'number' && data.resendAfterSec > 0 ? data.resendAfterSec : 0;
    setResendAfterSec(sec);
    setNotice(
      sessionConfig.patientCodeSentNotice.replace('{phone}', maskPhoneForDisplay(phoneValue)),
    );
    return true;
  }

  async function onPhoneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSignedOutNotice(null);
    setPending(true);
    try {
      const ok = await requestOtp(phone);
      if (ok) {
        setStep('code');
        setCode('');
      }
    } catch {
      setError('unavailable');
    } finally {
      setPending(false);
    }
  }

  async function onCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/patient-auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      if (!response.ok) {
        setError(mapStatus(response.status));
        return;
      }
      router.replace(sessionConfig.patientHomePath);
      router.refresh();
    } catch {
      setError('unavailable');
    } finally {
      setPending(false);
    }
  }

  async function onResend() {
    if (resendAfterSec > 0 || pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      await requestOtp(phone);
    } catch {
      setError('unavailable');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-brand-panel">
        <p className="type-label font-medium tracking-wide">Hospigo</p>
        <div className="login-brand-copy">
          <h1 className="type-title max-w-[var(--size-form-card-max)] font-medium leading-tight">
            {sessionConfig.patientBrandTitle}
          </h1>
          <p className="type-label mt-[var(--space-3)] text-login-brand-foreground/80">
            {sessionConfig.patientBrandSubtitle}
          </p>
        </div>
        <div aria-hidden="true" />
      </section>

      <section className="login-form-panel">
        <div className="login-form-card">
          <h2 className="type-heading mb-[var(--space-3)] font-medium">
            {step === 'phone'
              ? sessionConfig.patientStepPhoneHeading
              : sessionConfig.patientStepCodeHeading}
          </h2>

          {signedOutNotice && step === 'phone' ? (
            <p
              role="status"
              aria-live="polite"
              className="type-label mb-[var(--space-3)] text-muted-foreground"
            >
              {signedOutNotice}
            </p>
          ) : null}

          {step === 'phone' ? (
            <form className="login-form" onSubmit={onPhoneSubmit} noValidate>
              <label className="field-label" htmlFor="patient-phone">
                {sessionConfig.patientPhoneLabel}
                <input
                  id="patient-phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  className="field-input"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                  disabled={pending}
                />
              </label>
              {errorText ? (
                <p role="alert" aria-live="assertive" className="type-label text-destructive">
                  {errorText}
                </p>
              ) : null}
              <Button type="submit" className="touch-target" disabled={pending}>
                {pending ? sessionConfig.patientSendingLabel : sessionConfig.patientSendCodeLabel}
              </Button>
            </form>
          ) : (
            <form className="login-form" onSubmit={onCodeSubmit} noValidate>
              {notice ? (
                <p role="status" aria-live="polite" className="type-label text-muted-foreground">
                  {notice}
                </p>
              ) : null}
              <label className="field-label" htmlFor="patient-otp">
                {sessionConfig.patientCodeLabel}
                <input
                  id="patient-otp"
                  ref={codeInputRef}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="field-input"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  maxLength={sessionConfig.patientOtpCodeLength}
                  required
                  disabled={pending}
                />
              </label>
              {errorText ? (
                <p role="alert" aria-live="assertive" className="type-label text-destructive">
                  {errorText}
                </p>
              ) : null}
              <Button type="submit" className="touch-target" disabled={pending}>
                {pending ? sessionConfig.patientVerifyingLabel : sessionConfig.patientVerifyLabel}
              </Button>
              <div className="stack-tight mt-[var(--space-3)]">
                <p role="status" aria-live="polite" className="type-label text-muted-foreground">
                  {resendAfterSec > 0 ? countdownLabel : null}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="touch-target"
                  disabled={pending || resendAfterSec > 0}
                  onClick={() => {
                    void onResend();
                  }}
                >
                  {sessionConfig.patientResendLabel}
                </Button>
                <button
                  type="button"
                  className="type-label text-primary underline-offset-4 hover:underline"
                  disabled={pending}
                  onClick={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {sessionConfig.patientChangeNumberLabel}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
