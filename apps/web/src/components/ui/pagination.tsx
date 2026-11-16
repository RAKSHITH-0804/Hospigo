import { cn } from '@/lib/utils';

export function Pagination({
  page,
  totalPages,
  total,
  previousLabel,
  nextLabel,
  pageOfLabel,
  totalLabel,
  onPrevious,
  onNext,
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  previousLabel: string;
  nextLabel: string;
  /** Use {page} and {totalPages} placeholders. */
  pageOfLabel: string;
  /** Use {total} placeholder. */
  totalLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}) {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages || totalPages === 0;
  const pageText = pageOfLabel
    .replace('{page}', String(page))
    .replace('{totalPages}', String(Math.max(totalPages, 1)));
  const totalText = totalLabel.replace('{total}', String(total));

  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-[var(--space-3)]', className)}
    >
      <p className="type-small text-muted-foreground">
        {pageText}
        <span className="mx-[var(--space-2)]">·</span>
        {totalText}
      </p>
      <div className="flex gap-[var(--space-2)]">
        <button
          type="button"
          className="min-h-[var(--size-touch)] min-w-[var(--size-touch)] rounded-[var(--radius-control)] border border-border px-[var(--space-3)] type-label disabled:opacity-50"
          disabled={prevDisabled}
          onClick={onPrevious}
        >
          {previousLabel}
        </button>
        <button
          type="button"
          className="min-h-[var(--size-touch)] min-w-[var(--size-touch)] rounded-[var(--radius-control)] border border-border px-[var(--space-3)] type-label disabled:opacity-50"
          disabled={nextDisabled}
          onClick={onNext}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
