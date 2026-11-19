import type { Metadata } from 'next';
import { VisitTestsPanel } from '@/components/opd/visit-tests-panel';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { apiVisitPath, apiVisitTestsPath } from '@/lib/opd/server';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import type { VisitView } from '@/lib/opd/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.opd.tests.visit.title };

/** Reception: the tests of one visit, their bills, receipts and refund requests. */
export default async function VisitTestsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('opd.investigations.bill');
  const { id } = await params;
  const permissions = session.permissions ?? [];

  const [visit, tests] = await Promise.all([
    fetchStaffOnServer<VisitView>(apiVisitPath(id)),
    fetchStaffOnServer<VisitTestsResponse>(apiVisitTestsPath(id)),
  ]);

  if (visit.status === 'notFound' || tests.status === 'notFound') {
    return (
      <EmptyState
        title={staffCopy.opd.receipt.notFoundTitle}
        description={staffCopy.opd.receipt.notFoundDescription}
      />
    );
  }
  if (visit.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(visit))}
      </p>
    );
  }
  if (tests.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(tests))}
      </p>
    );
  }

  return (
    <VisitTestsPanel
      visit={visit.data}
      tests={tests.data}
      canRequestRefund={permissions.includes('opd.refunds.request')}
    />
  );
}
