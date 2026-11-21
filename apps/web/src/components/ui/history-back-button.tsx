'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { staffCopy } from '@/config/staff-copy';

/**
 * Back arrow that returns to the page the person opened this one from. When there is no page before
 * this one (opened in a new tab, or by typing the address) it goes to the fallback instead, so the
 * arrow never does nothing and never leaves the application.
 */
export function HistoryBackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={staffCopy.back}
      className="no-print page-header-back"
      data-testid="page-header-back"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
    >
      <ArrowLeft aria-hidden="true" className="size-[var(--size-icon-menu)]" />
    </button>
  );
}
