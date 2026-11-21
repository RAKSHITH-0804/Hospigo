'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.settings.help;

/**
 * The "About this page" block of a settings page: what the page is, how to set it, an example and
 * what is good to know, in plain words. It is CLOSED when the page opens (only people with a doubt
 * need it); "Show help" opens it and "Hide" closes it. Nothing is stored.
 */
export function SettingsHelp({ pageId }: { pageId: string }) {
  const page = copy.pages[pageId];
  const [open, setOpen] = useState(false);

  if (!page) {
    return null;
  }

  if (!open) {
    return (
      <div className="settings-help-closed">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <span aria-hidden="true">ⓘ</span> {copy.show}
        </Button>
      </div>
    );
  }

  return (
    <section className="settings-help" aria-label={copy.aboutTitle}>
      <div className="settings-help-head">
        <h2 className="type-label-strong">
          <span aria-hidden="true">ⓘ</span> {copy.aboutTitle}
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {copy.hide}
        </Button>
      </div>
      <p className="type-label">
        <strong>{copy.what}:</strong> {page.what}
      </p>
      <div>
        <p className="type-label-strong">{copy.how}</p>
        <ol className="settings-help-list settings-help-steps">
          {page.steps.map((step) => (
            <li key={step} className="type-label">
              {step}
            </li>
          ))}
        </ol>
      </div>
      <p className="type-label">
        <strong>{copy.example}:</strong> {page.example}
      </p>
      <div>
        <p className="type-label-strong">{copy.good}</p>
        <ul className="settings-help-list settings-help-points">
          {page.good.map((item) => (
            <li key={item} className="type-label">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
