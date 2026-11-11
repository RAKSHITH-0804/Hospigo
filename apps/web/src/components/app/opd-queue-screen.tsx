'use client';

import { useCallback } from 'react';
import { SampleDataBadge } from '@/components/sample-data-badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMockLoad } from '@/hooks/use-mock-load';
import { mockOpdQueue, type OpdQueue } from '@/mock/hospital-app';
import type { LoadMockOptions } from '@/mock/load-mock';

const emptyQueue: OpdQueue = {
  doctorName: '',
  speciality: '',
  stats: { waiting: 0, inConsultation: 0, seenToday: 0, onlineBookings: 0 },
  tokens: [],
};

function isEmptyQueue(value: OpdQueue) {
  return value.tokens.length === 0;
}

export function OpdQueueScreen({ loadOptions }: { loadOptions?: LoadMockOptions }) {
  const isEmpty = useCallback(isEmptyQueue, []);
  const { phase, value, reload } = useMockLoad(mockOpdQueue, emptyQueue, isEmpty, loadOptions);

  return (
    <div className="section-stack content-container-inner">
      <div className="cluster-between">
        <div>
          <div className="cluster">
            <h1 className="type-heading font-medium">OPD queue</h1>
            <SampleDataBadge />
          </div>
          {phase === 'ready' ? (
            <p className="type-label mt-[var(--space-1)] text-muted-foreground">
              {value.doctorName} · {value.speciality}
            </p>
          ) : null}
        </div>
        <Button type="button" disabled className="touch-target">
          Call next patient
        </Button>
      </div>

      {phase === 'loading' ? <LoadingState label="Loading OPD queue" /> : null}
      {phase === 'error' ? (
        <ErrorState message="OPD queue could not be loaded." onRetry={reload} />
      ) : null}
      {phase === 'empty' ? (
        <EmptyState title="No tokens yet" description="Queue tokens will appear here." />
      ) : null}

      {phase === 'ready' ? (
        <>
          <div className="stat-grid">
            <Card>
              <CardHeader>
                <CardTitle>Waiting</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="type-stat font-medium">{value.stats.waiting}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>In consultation</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="type-stat font-medium">{value.stats.inConsultation}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Seen today</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="type-stat font-medium">{value.stats.seenToday}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Online bookings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="type-stat font-medium">{value.stats.onlineBookings}</p>
              </CardContent>
            </Card>
          </div>

          <div className="table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="font-medium">Token</th>
                  <th className="font-medium">Patient</th>
                  <th className="font-medium">Slot</th>
                  <th className="font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {value.tokens.map((token) => (
                  <tr key={token.token}>
                    <td className="type-small font-mono">{token.token}</td>
                    <td>{token.patient}</td>
                    <td>{token.slot}</td>
                    <td>
                      <span className="status-chip" data-status={token.status}>
                        {token.status}
                      </span>
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
