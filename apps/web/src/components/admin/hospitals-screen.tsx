'use client';

import { useCallback } from 'react';
import { SampleDataBadge } from '@/components/sample-data-badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMockLoad } from '@/hooks/use-mock-load';
import { mockHqStats } from '@/mock/hq';
import { mockHospitals, type MockHospital } from '@/mock/hospitals';
import type { LoadMockOptions } from '@/mock/load-mock';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.admin.hospitals;

const emptyHospitals: MockHospital[] = [];

function isEmptyHospitals(value: MockHospital[]) {
  return value.length === 0;
}

function ModuleChips({ modules }: { modules: string[] }) {
  return (
    <div className="chip-row">
      {modules.map((module) => (
        <span key={module} className="module-chip">
          {module}
        </span>
      ))}
    </div>
  );
}

export function HospitalsScreen({ loadOptions }: { loadOptions?: LoadMockOptions }) {
  const isEmpty = useCallback(isEmptyHospitals, []);
  const { phase, value, reload } = useMockLoad(mockHospitals, emptyHospitals, isEmpty, loadOptions);

  return (
    <div className="section-stack content-container-inner">
      <div className="cluster-between">
        <div className="cluster">
          <h1 className="type-heading font-medium">{copy.title}</h1>
          <SampleDataBadge />
        </div>
        <Button type="button" disabled className="touch-target">
          {copy.onboard}
        </Button>
      </div>

      <div className="stat-grid">
        <Card>
          <CardHeader>
            <CardTitle>{copy.statHospitals}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="type-stat font-medium">{mockHqStats.hospitalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{copy.statStaff}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="type-stat font-medium">{mockHqStats.staffAccounts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{copy.statBackup}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="type-label">{mockHqStats.lastBackupLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{copy.statHealth}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="type-label">{mockHqStats.systemHealthLabel}</p>
          </CardContent>
        </Card>
      </div>

      {phase === 'loading' ? <LoadingState label={copy.loading} /> : null}
      {phase === 'error' ? <ErrorState message={copy.loadError} onRetry={reload} /> : null}
      {phase === 'empty' ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyHint} />
      ) : null}
      {phase === 'ready' ? (
        <>
          <ul className="hospitals-cards" data-testid="hospitals-card-list">
            {value.map((hospital) => (
              <li key={hospital.id} className="surface-card">
                <p className="font-medium">{hospital.name}</p>
                <p className="type-small mt-[var(--space-1)] font-mono text-muted-foreground">
                  {hospital.accessCode}
                </p>
                <div className="mt-[var(--space-3)]">
                  <ModuleChips modules={hospital.modules} />
                </div>
                <p className="mt-[var(--space-3)]">
                  <span className="module-chip">{hospital.status}</span>
                </p>
              </li>
            ))}
          </ul>

          <div className="hospitals-table-wrap table-panel" data-testid="hospitals-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="font-medium">{copy.colHospital}</th>
                  <th className="font-medium">{copy.colAccessCode}</th>
                  <th className="font-medium">{copy.colModules}</th>
                  <th className="font-medium">{copy.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {value.map((hospital) => (
                  <tr key={hospital.id}>
                    <td>{hospital.name}</td>
                    <td className="type-small font-mono">{hospital.accessCode}</td>
                    <td>
                      <ModuleChips modules={hospital.modules} />
                    </td>
                    <td>
                      <span className="module-chip">{hospital.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
