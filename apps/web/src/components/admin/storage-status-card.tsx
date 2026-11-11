'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { apiGet, type HealthResponse } from '@/lib/api';

export function StorageStatusCard() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setPhase('loading');
    apiGet<HealthResponse>('/health')
      .then((body) => {
        setStatus(body.status);
        setPhase('ready');
      })
      .catch(() => {
        setPhase('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
      </CardHeader>
      <CardContent>
        {phase === 'loading' ? <LoadingState label="Checking status" /> : null}
        {phase === 'error' ? (
          <ErrorState message="Status could not be loaded." onRetry={load} />
        ) : null}
        {phase === 'ready' ? <p className="text-sm">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
