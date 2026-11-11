'use client';

import { useState } from 'react';
import { SampleDataBadge } from '@/components/sample-data-badge';
import { Button } from '@/components/ui/button';

type LoginTab = 'hospital' | 'hq';

export default function LoginPage() {
  const [tab, setTab] = useState<LoginTab>('hospital');

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
            <SampleDataBadge />
          </div>

          <div role="tablist" aria-label="Sign-in type" className="login-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'hospital'}
              className="login-tab"
              onClick={() => setTab('hospital')}
            >
              Hospital staff
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'hq'}
              className="login-tab"
              onClick={() => setTab('hq')}
            >
              Indigo HQ
            </button>
          </div>

          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            {tab === 'hospital' ? (
              <label className="field-label">
                Access code
                <input
                  name="accessCode"
                  autoComplete="off"
                  className="field-input"
                  defaultValue=""
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
                defaultValue=""
              />
            </label>
            <label className="field-label">
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                className="field-input"
                defaultValue=""
              />
            </label>
            <Button type="submit" className="touch-target">
              Sign in
            </Button>
          </form>

          <p className="type-label mt-[var(--space-3)] text-muted-foreground">
            Sample screen — login arrives in Step 6.
          </p>
        </div>
      </section>
    </div>
  );
}
