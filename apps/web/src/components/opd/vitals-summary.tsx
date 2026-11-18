import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';
import type { VitalsReadingView } from '@/lib/opd/clinical-types';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.clinical;

/** Read-only current vitals of a visit (consultation screen). Out-of-range values are flagged. */
export function VitalsSummary({
  readings,
  editHref,
}: {
  readings: VitalsReadingView[];
  /** Present only for staff who may record vitals. */
  editHref?: string;
}) {
  return (
    <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.consult.vitalsHeading}>
      <div className="cluster-between">
        <h2 className="section-heading">{copy.consult.vitalsHeading}</h2>
        {editHref ? (
          <Link
            href={editHref}
            className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
          >
            {copy.consult.vitalsEdit}
          </Link>
        ) : null}
      </div>
      {readings.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.consult.vitalsEmpty}</p>
      ) : (
        <ul className="flex flex-wrap gap-[var(--space-3)]">
          {readings.map((r) => (
            <li key={r.code} className="flex items-center gap-[var(--space-2)] type-label">
              <span className="text-muted-foreground">{r.name}</span>
              <span className="type-label-strong">
                {r.value} {r.unit}
              </span>
              {r.outOfRange ? <Badge variant="danger">{copy.vitals.outOfRange}</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
