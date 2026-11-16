'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export function Tooltip({
  content,
  children,
  className,
  side = 'right',
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  side?: 'right' | 'bottom';
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const child = Children.only(children);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function onBlur() {
    requestAnimationFrame(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        setOpen(false);
      }
    });
  }

  function onKeyDownLocal(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const trigger =
    isValidElement(child) && open
      ? cloneElement(child as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': tipId,
        })
      : child;

  return (
    <span
      ref={rootRef}
      className={cn('ui-tooltip-root', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDownLocal}
    >
      {trigger}
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className={cn('ui-tooltip-panel', side === 'bottom' && 'ui-tooltip-panel-bottom')}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
