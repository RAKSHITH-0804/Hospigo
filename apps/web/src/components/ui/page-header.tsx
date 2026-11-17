import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  backHref,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional back control; hidden when printing via `.no-print`. */
  backHref?: string;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-wrap items-start justify-between gap-[var(--space-3)]', className)}
    >
      <div className="min-w-0">
        {/* The arrow sits on the title line so it lines up with the title text. */}
        <div className="flex items-center gap-[var(--space-2)]">
          {backHref ? (
            <Link
              href={backHref}
              aria-label={staffCopy.back}
              className="no-print page-header-back"
              data-testid="page-header-back"
            >
              <ArrowLeft aria-hidden="true" className="size-[var(--size-icon-menu)]" />
            </Link>
          ) : null}
          <h1 className="type-title font-semibold text-foreground">{title}</h1>
        </div>
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
