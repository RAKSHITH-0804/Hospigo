import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Kbd(
  { className, ...props },
  ref,
) {
  return (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-badge)] border border-border bg-muted px-[var(--space-2)] py-[var(--space-1)] type-small font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
});
