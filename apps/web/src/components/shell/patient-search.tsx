'use client';

import { useEffect, useRef } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { staffCopy } from '@/config/staff-copy';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

/** GET form to /app/patients plus "/" focus shortcut (Escape blurs). */
export function PatientSearch() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isTypingTarget(event.target)) {
          return;
        }
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <form
      method="get"
      action="/app/patients"
      className="shell-patient-search"
      role="search"
      aria-label={staffCopy.shell.patientSearchLabel}
    >
      <label htmlFor="shell-patient-q" className="sr-only">
        {staffCopy.shell.patientSearchLabel}
      </label>
      <input
        ref={inputRef}
        id="shell-patient-q"
        name="q"
        type="search"
        className="shell-patient-search-input"
        placeholder={staffCopy.shell.patientSearchPlaceholder}
        autoComplete="off"
      />
      <Kbd aria-hidden="true">{staffCopy.shell.patientSearchShortcut}</Kbd>
    </form>
  );
}
