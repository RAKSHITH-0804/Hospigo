'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.admin.storage;

type HealthResponse = {
  status: string;
};

export function StorageStatusCard() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setPhase('loading');
    fetch('/api/health', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('health failed');
        }
        return (await response.json()) as HealthResponse;
      })
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
        <CardTitle>{copy.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {phase === 'loading' ? <LoadingState label={copy.checking} /> : null}
        {phase === 'error' ? <ErrorState message={copy.loadError} onRetry={load} /> : null}
        {phase === 'ready' ? <p className="text-sm">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
