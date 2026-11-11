'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';

export default function StaffHomePage() {
  const [retried, setRetried] = useState(false);

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <h1 className="text-xl font-medium">Dashboard</h1>
      <LoadingState label="Loading dashboard" />
      <EmptyState title="No records yet" description="Records will appear here." />
      <ErrorState
        message={retried ? 'Retry requested.' : 'Example error. Nothing was lost.'}
        onRetry={() => setRetried(true)}
      />
    </div>
  );
}
