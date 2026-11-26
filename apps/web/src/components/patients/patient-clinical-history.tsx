'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { formatDateOnly } from '@/lib/patients/format';

const copy = staffCopy.patients.history;

type Visit = {
  visitId: string;
  visitDate: string;
  status: string;
  branch: { id: string; name: string };
  doctor: { id: string; name: string };
  receptionSymptoms: string | null;
  consultation: null | {
    complaints: string | null;
    diagnosis: string | null;
    advice: string | null;
    completed: boolean;
    amended: boolean;
  };
  prescription: Array<{
    lineNo: number;
    medicineName: string;
    dose: string;
    frequency: string;
    duration: string;
  }>;
};

/**
 * The whole clinical history of a patient for a doctor (all branches, all doctors), read-only. It is
 * loaded only when the person asks for it, because opening it is written to the access log.
 */
export function PatientClinicalHistory({ patientId }: { patientId: string }) {
  const [state, setState] = useState<
    { phase: 'idle' } | { phase: 'loading' } | { phase: 'error' } | { phase: 'ok'; visits: Visit[] }
  >({ phase: 'idle' });

  async function load() {
    setState({ phase: 'loading' });
    try {
      const response = await fetch(
        `/api/staff/patients/${encodeURIComponent(patientId)}/clinical-history`,
      );
      if (!response.ok) {
        setState({ phase: 'error' });
        return;
      }
      const data = (await response.json()) as { visits: Visit[] };
      setState({ phase: 'ok', visits: data.visits });
    } catch {
      setState({ phase: 'error' });
    }
  }

  return (
    <section className="flex flex-col gap-[var(--space-2)]" aria-label={copy.heading}>
      <h2 className="section-heading">{copy.heading}</h2>
      <p className="type-small text-muted-foreground">{copy.hint}</p>
      {state.phase === 'idle' || state.phase === 'error' ? (
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <Button
            type="button"
            variant="outline"
            className="touch-target"
            onClick={() => void load()}
          >
            {copy.show}
          </Button>
          {state.phase === 'error' ? (
            <p role="alert" className="type-label text-destructive">
              {copy.failed}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.phase === 'loading' ? <p className="type-label">{copy.loading}</p> : null}
      {state.phase === 'ok' && state.visits.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : null}
      {state.phase === 'ok' ? (
        <ul className="flex flex-col gap-[var(--space-3)]">
          {state.visits.map((visit) => (
            <li key={visit.visitId} className="consult-card flex flex-col gap-[var(--space-1)]">
              <p className="type-label font-medium">
                {fill(copy.visitLine, {
                  date: formatDateOnly(visit.visitDate),
                  branch: visit.branch.name,
                  doctor: visit.doctor.name,
                })}
                {visit.consultation?.amended ? ` · ${copy.amended}` : ''}
              </p>
              {visit.receptionSymptoms ? (
                <p className="type-small">
                  {fill(copy.receptionSymptoms, { text: visit.receptionSymptoms })}
                </p>
              ) : null}
              {visit.consultation ? (
                <>
                  {visit.consultation.complaints ? (
                    <p className="type-small">
                      {fill(copy.symptoms, { text: visit.consultation.complaints })}
                    </p>
                  ) : null}
                  {visit.consultation.diagnosis ? (
                    <p className="type-small">
                      {fill(copy.diagnosis, { text: visit.consultation.diagnosis })}
                    </p>
                  ) : null}
                  {visit.consultation.advice ? (
                    <p className="type-small">
                      {fill(copy.advice, { text: visit.consultation.advice })}
                    </p>
                  ) : null}
                  {!visit.consultation.completed ? (
                    <p className="type-small text-muted-foreground">{copy.notCompleted}</p>
                  ) : null}
                  {visit.prescription.length > 0 ? (
                    <div>
                      <p className="type-small font-medium">{copy.medicines}</p>
                      <ul className="type-small">
                        {visit.prescription.map((row) => (
                          <li key={row.lineNo}>
                            {row.medicineName} · {row.dose} · {row.frequency} · {row.duration}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="type-small text-muted-foreground">{copy.noNote}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
