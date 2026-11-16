import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-wrap items-start justify-between gap-[var(--space-3)]', className)}
    >
      <div className="min-w-0">
        <h1 className="type-title font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="mt-[var(--space-1)] type-label text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-[var(--space-2)]">{actions}</div>
      ) : null}
    </header>
  );
}
