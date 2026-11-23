'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A pop-up dialog. The page behind is dimmed and cannot be used until it closes. It closes with the
 * Close button, the Escape key or a click on the dimmed area (not on a click inside). Focus moves
 * into it, Tab stays inside it, and focus returns to what opened it. The caller shows it only while
 * it should be open (render it conditionally).
 */
export function Modal({
  title,
  onClose,
  children,
  narrow,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  narrow?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    if (event.key === 'Escape') {
      // A calendar open inside the dialog closes first (it handles Escape itself).
      if (panel.querySelector('[role="dialog"]')) {
        return;
      }
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn('modal-panel', narrow ? 'modal-panel-narrow' : undefined)}
      >
        <div className="modal-head">
          <h2 id={titleId} className="type-label-strong">
            {title}
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {staffCopy.modal.close}
          </Button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
