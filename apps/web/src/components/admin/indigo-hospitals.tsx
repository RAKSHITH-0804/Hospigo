'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { saveHospitalModules } from '@/lib/indigo/client';
import type { IndigoHospitalRow, IndigoOverview } from '@/lib/indigo/types';
import { cn } from '@/lib/utils';

const copy = staffCopy.admin.indigo;
const consoleCopy = staffCopy.admin.console;

export type IndigoHospital = { id: string; code: string; name: string };

function ModuleSwitches({
  hospital,
  catalog,
}: {
  hospital: IndigoHospitalRow;
  catalog: IndigoOverview['moduleCatalog'];
}) {
  const [on, setOn] = useState<string[]>(hospital.modules);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await saveHospitalModules(hospital.id, on);
    setBusy(false);
    setMessage(
      result.ok
        ? { ok: true, text: consoleCopy.modulesSaved }
        : { ok: false, text: consoleCopy.modulesFailed },
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <p className="type-small font-medium">{consoleCopy.modulesHeading}</p>
      <div className="flex flex-wrap gap-[var(--space-3)]">
        {catalog.map((module) => (
          <label key={module.code} className="flex items-center gap-[var(--space-1)] type-small">
            <input
              type="checkbox"
              checked={on.includes(module.code)}
              disabled={busy || module.code === 'OPD'}
              onChange={(event) =>
                setOn((current) =>
                  event.target.checked
                    ? [...current, module.code]
                    : current.filter((code) => code !== module.code),
                )
              }
            />
            {module.name}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>
          {busy ? consoleCopy.modulesSaving : consoleCopy.modulesSave}
        </Button>
        {message ? (
          <p role={message.ok ? 'status' : 'alert'} className="type-small">
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The real hospitals an Indigo person may see: status, branches (access codes for the Owner only),
 * modules (the Owner switches them), and Enter. The server decides what each person may do.
 */
export function IndigoHospitals({ overview }: { overview: IndigoOverview }) {
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
        {overview.canManage ? (
          <Link href="/admin/onboard" className={cn(buttonVariants(), 'touch-target')}>
            {consoleCopy.navOnboard}
          </Link>
        ) : null}
      </div>
      <p className="type-label text-muted-foreground">{copy.hint}</p>
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
      {overview.items.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyHint} />
      ) : (
        <div className="stat-grid">
          {overview.items.map((hospital) => (
            <Card key={hospital.id}>
              <CardHeader>
                <CardTitle className="section-heading">{hospital.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-[var(--space-2)]">
                <p className="type-small text-muted-foreground">
                  {hospital.code} · {fill(consoleCopy.status, { status: hospital.status })}
                </p>
                <div>
                  <p className="type-small font-medium">{consoleCopy.branchesHeading}</p>
                  <ul className="type-small">
                    {hospital.branches.map((branch) => (
                      <li key={branch.id}>
                        {branch.accessCode
                          ? fill(consoleCopy.branchLine, {
                              name: branch.name,
                              code: branch.code,
                              accessCode: branch.accessCode,
                            })
                          : fill(consoleCopy.branchLineNoCode, {
                              name: branch.name,
                              code: branch.code,
                            })}
                        {branch.isMain ? ` · ${consoleCopy.mainBranch}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                {overview.canManage ? (
                  <ModuleSwitches hospital={hospital} catalog={overview.moduleCatalog} />
                ) : (
                  <p className="type-small">{hospital.modules.join(', ')}</p>
                )}
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
