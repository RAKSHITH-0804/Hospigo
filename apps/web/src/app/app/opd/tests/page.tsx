import type { Metadata } from 'next';
import { TestsToBill } from '@/components/opd/tests-to-bill';
import { EmptyState } from '@/components/states/empty-state';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { API_OPD_PAYMENT_MODES, API_OPD_PENDING_TESTS } from '@/lib/opd/server';
import type { PendingTestsResponse } from '@/lib/opd/tests-types';
import type { PaymentModesResponse } from '@/lib/opd/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

const copy = staffCopy.opd.tests.reception;

export const metadata: Metadata = { title: staffCopy.pageTitles.opdTests };

export default async function TestsToBillPage() {
  const session = await requirePermission('opd.investigations.bill');

  // Billing the tests also takes the money: both permissions are needed (the API checks again).
  if (!session.permissions?.includes('opd.billing.collect')) {
    return <EmptyState title={copy.noPermissionTitle} description={copy.noPermissionDescription} />;
  }

  // Independent first-paint fetches run in parallel.
  const [pending, modes] = await Promise.all([
    fetchStaffOnServer<PendingTestsResponse>(API_OPD_PENDING_TESTS),
    fetchStaffOnServer<PaymentModesResponse>(API_OPD_PAYMENT_MODES),
  ]);

  if (pending.status !== 'ok') {
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        <p className="type-label-strong">{copy.loadErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(pending))}
        </p>
      </div>
    );
  }
  if (modes.status !== 'ok') {
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        <p className="type-label-strong">{staffCopy.opd.newVisit.paymentModesErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(modes))}
        </p>
      </div>
    );
  }
  if (modes.data.items.length === 0 || !modes.data.defaultCode) {
    return <EmptyState title={staffCopy.opd.newVisit.noPaymentModes} />;
  }

  return (
    <TestsToBill
      initial={pending.data}
      paymentModes={{
        items: modes.data.items,
        defaultCode: modes.data.defaultCode,
        maxLines: modes.data.maxLines,
      }}
      refreshSeconds={opdWebConfig.pendingRefreshSeconds}
    />
  );
}
