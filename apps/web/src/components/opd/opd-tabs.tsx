'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

export type OpdTabItem = { href: string; label: string };

/**
 * The OPD sections a person may open (Queue, Tests to bill, Refund requests), as plain links. It
 * shows only on those top-level pages (never on a consultation, vitals or receipt page) and only
 * when there is something to choose: two or more sections, or a single section to move to from a
 * page that is not one of them (for example an Admin on the empty queue page).
 */
export function OpdTabs({ items }: { items: OpdTabItem[] }) {
  const pathname = (usePathname() ?? '').replace(/\/$/, '');
  const topLevel = ['/app/opd', ...items.map((i) => i.href)];
  if (items.length === 0 || !topLevel.includes(pathname)) {
    return null;
  }
  if (items.length < 2 && items.some((i) => i.href === pathname)) {
    return null;
  }
  return (
    <nav
      aria-label={staffCopy.opd.tests.nav.label}
      className="opd-tabs flex flex-wrap gap-[var(--space-2)] pb-[var(--space-3)]"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? 'page' : undefined}
          className={cn(
            buttonVariants({ variant: pathname === item.href ? 'default' : 'outline' }),
            'touch-target',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
