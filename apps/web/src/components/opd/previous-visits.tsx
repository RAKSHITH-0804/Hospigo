import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';
import { opdWebConfig } from '@/config/opd';
import { consultPath } from '@/lib/opd/clinical-client';
import { fill } from '@/lib/opd/clinical-format';
import { apiPatientVisitsPath } from '@/lib/opd/server';
import type { VisitListResponse } from '@/lib/opd/types';
import { fetchStaffOnServer } from '@/lib/patients/server';
import { formatDateOnly } from '@/lib/patients/format';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.clinical.consult;

/**
 * Earlier COMPLETED visits of this patient that the caller may see (a doctor: their own; a nurse:
 * the branch). Streamed in after the main screen so it never slows the first paint. Opening one
 * shows its read-only note (that read is audited by the API). A failure just shows an empty list.
 */
export async function PreviousVisits({
  patientId,
  currentVisitId,
}: {
  patientId: string;
  currentVisitId: string;
}) {
  const limit = opdWebConfig.previousVisitsLimit;
  const result = await fetchStaffOnServer<VisitListResponse>(apiPatientVisitsPath(patientId), {
    pageSize: limit + 5,
  });
  const visits =
    result.status === 'ok'
      ? result.data.items
          .filter((v) => v.status === 'COMPLETED' && v.id !== currentVisitId)
          .slice(0, limit)
      : [];
  return (
    <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.previousHeading}>
      <h2 className="section-heading">{copy.previousHeading}</h2>
      {visits.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.previousEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-2)]">
          {visits.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-[var(--space-3)]">
              <span className="type-label">
                {fill(copy.previousLine, {
                  date: formatDateOnly(v.visitDate),
                  doctor: v.doctor.name,
                })}
              </span>
              <Link
                href={consultPath(v.id)}
                className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
              >
                {copy.previousOpen}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
