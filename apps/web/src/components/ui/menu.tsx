'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type MenuAction = {
  id: string;
  label: string;
  /** A link (for example a download). */
  href?: string;
  /** Or something to do when chosen. */
  onSelect?: () => void;
};

/**
 * A button that opens a short list of actions (like the Print menu of a word processor). It closes
 * after a choice, with Escape and with a click outside; the arrow keys, Home and End move through
 * the list. Items are real links or buttons, so they work with the keyboard and screen readers.
 */
export function ActionMenu({
  label,
  actions,
  icon,
  disabled,
}: {
  label: string;
  actions: readonly MenuAction[];
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const items = () => [
    ...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];

  function focusAt(index: number) {
    const list = items();
    list[(index + list.length) % list.length]?.focus();
  }

  function onPopupKey(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(at + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(at <= 0 ? -1 : at - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(-1);
    }
  }

  function choose(action: MenuAction) {
    setOpen(false);
    action.onSelect?.();
  }

  return (
    <div ref={rootRef} className="action-menu">
      <Button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => focusAt(0));
          }
        }}
      >
        {icon}
        {label}
        <ChevronDown aria-hidden="true" />
      </Button>
      {open ? (
        <div
          id={popupId}
          role="menu"
          aria-label={label}
          className="action-menu-popup"
          onKeyDown={onPopupKey}
        >
          {actions.map((action) =>
            action.href ? (
              <a
                key={action.id}
                role="menuitem"
                href={action.href}
                className="action-menu-item"
                onClick={() => choose(action)}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="action-menu-item"
                onClick={() => choose(action)}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
