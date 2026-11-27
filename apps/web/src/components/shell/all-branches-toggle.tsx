import { Building2, Layers } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

const copy = staffCopy.allBranches;

/**
 * Phase 2.2: "All my branches" on the read and review screens (Dashboard, OPD queue, Refund requests).
 * A real button (a link that adds or removes ?branch=ALL); the API decides who may (two or more
 * branches). Changes (taking cash, starting a visit) always need one active branch.
 */
export function AllBranchesToggle({ href, active }: { href: string; active: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-3)] pb-[var(--space-3)]">
      <Link
        href={active ? href : `${href}?branch=ALL`}
        className={cn(buttonVariants({ variant: active ? 'default' : 'outline' }), 'gap-2')}
      >
        {active ? <Building2 aria-hidden="true" /> : <Layers aria-hidden="true" />}
        {active ? copy.off : copy.on}
      </Link>
      {active ? <span className="type-label text-muted-foreground">{copy.note}</span> : null}
    </div>
  );
}
