import Link from 'next/link';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.allBranches;

/**
 * Phase 2.2: "All my branches" on the read and review screens (Dashboard, OPD queue, Refund requests).
 * A plain link that adds or removes ?branch=ALL; the API decides who may (two or more branches).
 * Changes (taking cash, starting a visit) always need one active branch.
 */
export function AllBranchesToggle({ href, active }: { href: string; active: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      <Link href={active ? href : `${href}?branch=ALL`} className="type-small underline">
        {active ? copy.off : copy.on}
      </Link>
      {active ? <span className="type-small text-muted-foreground">{copy.note}</span> : null}
    </div>
  );
}
