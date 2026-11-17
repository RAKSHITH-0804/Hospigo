import type { ReactNode } from 'react';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

/** Token-styled placeholder block. Sizes live in globals.css (.skeleton-*). */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton', className)} />;
}

/** Page frame shown instantly while the real page streams in (loading.tsx). */
export function PageSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={staffCopy.loadingPage}
      className="flex flex-col gap-[var(--space-3)]"
    >
      <SkeletonBlock className="skeleton-title" />
      {children}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <SkeletonBlock className="skeleton-control" />
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonBlock key={index} className="skeleton-row" />
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock key={index} className="skeleton-card" />
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 8 }: { fields?: number }) {
  return (
    <div className="patient-form-grid">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="patient-form-cell" data-span="4">
          <SkeletonBlock className="skeleton-line" />
          <SkeletonBlock className="skeleton-control" />
        </div>
      ))}
    </div>
  );
}
