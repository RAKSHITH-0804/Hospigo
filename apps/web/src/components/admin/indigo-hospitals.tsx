'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.admin.indigo;

export type IndigoHospital = { id: string; code: string; name: string };

/**
 * The real hospitals an Indigo person may enter. "Enter" opens the hospital with the Indigo role
 * (Owner: full power; Employee: configuration only). The server decides what is allowed.
 */
export function IndigoHospitals({ hospitals }: { hospitals: IndigoHospital[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enter(hospitalId: string) {
    setBusyId(hospitalId);
    setError(null);
    try {
      const response = await fetch('/api/auth/indigo-enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitalId }),
      });
      if (response.ok) {
        router.replace(sessionConfig.homeHospital);
        router.refresh();
        return;
      }
      setError(
        response.status === 403
          ? copy.notAvailable
          : response.status === 429
            ? copy.rateLimited
            : copy.failed,
      );
    } catch {
      setError(copy.failed);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="section-stack content-container-inner">
      <div className="cluster-between">
        <h1 className="type-heading font-medium">{copy.title}</h1>
      </div>
      <p className="type-label text-muted-foreground">{copy.hint}</p>
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
      {hospitals.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyHint} />
      ) : (
        <div className="stat-grid">
          {hospitals.map((hospital) => (
            <Card key={hospital.id}>
              <CardHeader>
                <CardTitle className="section-heading">{hospital.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-[var(--space-2)]">
                <p className="type-small text-muted-foreground">{hospital.code}</p>
                <Button
                  type="button"
                  className="touch-target w-fit"
                  disabled={busyId !== null}
                  onClick={() => void enter(hospital.id)}
                >
                  {busyId === hospital.id ? copy.entering : copy.enter}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
