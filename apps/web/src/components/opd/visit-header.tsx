import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { staffCopy } from '@/config/staff-copy';
import type { ClinicalVisit, ClinicalVisitStatus } from '@/lib/opd/clinical-types';
import { fill } from '@/lib/opd/clinical-format';
import { EMPTY_VALUE, formatDateOnly, genderLabel } from '@/lib/patients/format';

const copy = staffCopy.opd.clinical;

export const CLINICAL_STATUS_VARIANT: Record<ClinicalVisitStatus, BadgeVariant> = {
  AWAITING_PAYMENT: 'warning',
  WAITING: 'warning',
  IN_CONSULTATION: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export function ageText(ageYears: number | null): string {
  return ageYears === null ? EMPTY_VALUE : fill(copy.patient.ageYears, { age: ageYears });
}

/** Patient, token, doctor and status of one visit (shared by the vitals and consultation screens). */
export function VisitHeader({ visit }: { visit: ClinicalVisit }) {
  const p = visit.patient;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <p className="type-heading font-medium">{p.name}</p>
          <p className="type-label text-muted-foreground">
            {copy.patient.uhid} {p.uhid} · {genderLabel(p.gender)} · {ageText(p.ageYears)}
          </p>
          <p className="type-label text-muted-foreground">
            {copy.patient.doctor}: {visit.doctor.name} · {copy.patient.visitDate}:{' '}
            {formatDateOnly(visit.visitDate)}
          </p>
        </div>
        <div className="flex items-center gap-[var(--space-3)]">
          {visit.token ? (
            <span className="type-stat font-medium" aria-label={copy.patient.token}>
              {visit.token.label}
            </span>
          ) : null}
          <Badge variant={CLINICAL_STATUS_VARIANT[visit.status]}>
            {copy.visitStatus[visit.status]}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
