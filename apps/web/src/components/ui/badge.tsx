import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'success' | 'warning' | 'info' | 'neutral' | 'danger';

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: 'bg-[var(--badge-success)] text-[var(--badge-success-foreground)]',
  warning: 'bg-[var(--badge-warning)] text-[var(--badge-warning-foreground)]',
  info: 'bg-[var(--badge-info)] text-[var(--badge-info-foreground)]',
  neutral: 'bg-[var(--badge-neutral)] text-[var(--badge-neutral-foreground)]',
  danger: 'bg-[var(--badge-danger)] text-[var(--badge-danger-foreground)]',
};

export const Badge = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }
>(function Badge({ className, variant = 'neutral', ...props }, ref) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-badge)] px-[var(--space-2)] py-[var(--space-1)] type-small font-medium',
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    />
  );
});
