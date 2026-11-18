'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { VisitHeader } from '@/components/opd/visit-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { recordVitals } from '@/lib/opd/clinical-client';
import { fill, formatDateTime } from '@/lib/opd/clinical-format';
import type { ClinicalVisit, VitalsField, VitalsReadingView } from '@/lib/opd/clinical-types';
import { opdErrorMessageFor } from '@/lib/opd/client';
import { isCorrection, planVitals, type VitalsDraft } from '@/lib/opd/vitals-plan';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.clinical.vitals;

/**
 * Record and correct the vitals of one visit. A blank box is skipped, a value equal to the
 * current reading is skipped, and changing an existing reading asks for a reason (the old reading
 * stays in the history). Nothing is sent until every typed value is valid; the API checks again.
 */
export function VitalsForm({
  visit,
  fields,
  initial,
  canWrite,
  backHref,
}: {
  visit: ClinicalVisit;
  fields: VitalsField[];
  initial: VitalsReadingView[];
  canWrite: boolean;
  backHref: string;
}) {
  const [readings, setReadings] = useState<VitalsReadingView[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, VitalsDraft>>({});
  const [showProblems, setShowProblems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A ref (not state) so two clicks in the same moment still send one request.
  const inFlight = useRef(false);

  const current = new Map(readings.map((r) => [r.code, r]));
  const plan = planVitals(fields, drafts, readings);

  function setDraft(code: string, patch: Partial<VitalsDraft>) {
    setNotice(null);
    setError(null);
    setDrafts((d) => ({ ...d, [code]: { value: '', reason: '', ...d[code], ...patch } }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    setError(null);
    setNotice(null);
    if (Object.keys(plan.problems).length > 0) {
      setShowProblems(true);
      return;
    }
    if (!plan.ok) {
      setError(copy.nothingToSave);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    const result = await recordVitals(visit.id, plan.readings);
    inFlight.current = false;
    setSubmitting(false);
    if (!result.ok) {
      setError(opdErrorMessageFor(result.code));
      return;
    }
    setReadings(result.data.fields);
    setDrafts({});
    setShowProblems(false);
    setNotice(copy.saved);
  }

  return (
    <div className="section-stack content-container-inner">
      <PageHeader title={copy.title} description={copy.description} backHref={backHref} />
      <VisitHeader visit={visit} />
      {fields.length === 0 ? (
        <EmptyState title={copy.noFieldsTitle} description={copy.noFieldsDescription} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-[var(--space-4)]" noValidate>
          {canWrite ? null : (
            <p className="type-label text-muted-foreground">{copy.readOnlyNote}</p>
          )}
          <div className="vitals-grid">
            {fields.map((field) => {
              const existing = current.get(field.code);
              const draft = drafts[field.code] ?? { value: '', reason: '' };
              const problem = showProblems ? plan.problems[field.code] : undefined;
              const needsReason = isCorrection(field, draft.value, existing);
              return (
                <Card key={field.code}>
                  <CardContent className="flex flex-col gap-[var(--space-1)]">
                    <div className="cluster-between">
                      <p className="type-label-strong">
                        {field.name} ({field.unit})
                      </p>
                      {existing?.outOfRange ? (
                        <Badge variant="danger">{copy.outOfRange}</Badge>
                      ) : null}
                    </div>
                    <p className="type-label text-muted-foreground">
                      {copy.current}:{' '}
                      {existing ? `${existing.value} ${existing.unit}` : copy.notRecorded}
                    </p>
                    {canWrite ? (
                      <div className="flex flex-col gap-[var(--space-2)]">
                        <InputField
                          hideLabel
                          label={`${field.name}: ${copy.newValue}`}
                          placeholder={copy.newValue}
                          inputMode={field.valueKind === 'NUMBER' ? 'decimal' : 'text'}
                          autoComplete="off"
                          value={draft.value}
                          error={problem === 'INVALID' ? copy.invalidValue : undefined}
                          onChange={(e) => setDraft(field.code, { value: e.target.value })}
                        />
                        {needsReason ? (
                          <InputField
                            label={`${field.name}: ${copy.reason}`}
                            hint={copy.reasonHint}
                            autoComplete="off"
                            value={draft.reason}
                            error={problem === 'REASON' ? copy.needsReason : undefined}
                            onChange={(e) => setDraft(field.code, { reason: e.target.value })}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {existing && existing.history.length > 1 ? (
                      <details>
                        <summary className="type-small cursor-pointer text-muted-foreground">
                          {copy.history}
                        </summary>
                        <ul className="mt-[var(--space-1)] flex flex-col gap-[var(--space-1)]">
                          {existing.history.map((h) => (
                            <li key={h.version} className="type-small">
                              {fill(copy.historyEntry, {
                                version: h.version,
                                value: h.value,
                                who: h.recordedBy.name,
                              })}{' '}
                              <span suppressHydrationWarning>{formatDateTime(h.recordedAt)}</span>
                              {h.correctionReason
                                ? ` · ${fill(copy.historyReason, { reason: h.correctionReason })}`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="type-label text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-[var(--space-3)]">
            {canWrite ? (
              <Button type="submit" className="touch-target" disabled={submitting}>
                {submitting ? copy.saving : copy.save}
              </Button>
            ) : null}
            <Link
              href={backHref}
              className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
            >
              {copy.backToQueue}
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
