'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type Position = { top: number; left: number };

/**
 * Tooltip rendered in a portal on document.body with fixed positioning taken from the
 * trigger's bounding rect, so no scroll container or overflow:hidden parent (the sidebar)
 * can clip it. The portal exists only after mount: the server render and the first client
 * render contain no tooltip markup, so there is nothing to mismatch on hydration.
 * Closes on Escape, blur, mouse leave, scroll and resize (it never moves the layout).
 */
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
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const child = Children.only(children);

  useEffect(() => {
    setMounted(true);
  }, []);

  const show = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition(
        side === 'bottom'
          ? { top: rect.bottom, left: rect.left + rect.width / 2 }
          : { top: rect.top + rect.height / 2, left: rect.right },
      );
    }
    setOpen(true);
  }, [side]);

  const hide = useCallback(() => setOpen(false), []);

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
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open, hide]);

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

  const visible = mounted && open && position !== null;
  const trigger =
    isValidElement(child) && visible
      ? cloneElement(child as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': tipId,
        })
      : child;

  return (
    <span
      ref={rootRef}
      className={cn('ui-tooltip-root', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={onBlur}
      onKeyDown={onKeyDownLocal}
    >
      {trigger}
      {visible
        ? createPortal(
            <span
              id={tipId}
              role="tooltip"
              data-side={side}
              className="ui-tooltip-panel"
              style={{ top: position.top, left: position.left }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
