'use client';

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TabItem = { value: string; label: string };

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const baseId = useId();

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.value === value);
    if (index < 0) {
      return;
    }
    let next = index;
    if (event.key === 'ArrowRight') {
      next = (index + 1) % items.length;
    } else if (event.key === 'ArrowLeft') {
      next = (index - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    onChange(items[next]!.value);
  }

  return (
    <div
      role="tablist"
      className={cn('flex flex-wrap gap-[var(--space-1)]', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${baseId}-${item.value}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cn(
              'min-h-[var(--size-touch)] rounded-[var(--radius-control)] px-[var(--space-3)] type-label',
              selected
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted text-muted-foreground',
            )}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  when,
  value,
  children,
}: {
  when: string;
  value: string;
  children: ReactNode;
}) {
  if (when !== value) {
    return null;
  }
  return <div role="tabpanel">{children}</div>;
}
