import type { Metadata } from 'next';
import { VisitReceipt } from '@/components/opd/visit-receipt';
import { EmptyState } from '@/components/states/empty-state';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { apiVisitPath, apiVisitTestsPath } from '@/lib/opd/server';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import type { VisitView } from '@/lib/opd/types';
import { errorMessageFor } from '@/lib/patients/client';
import { slipPageRule } from '@/lib/patients/format';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.opd.receipt.pageTitle };

/** Receipt of ONE investigations bill (the same print view as the visit receipt). */
export default async function TestsReceiptPage({
  params,
}: {
  params: Promise<{ id: string; billId: string }>;
}) {
  const session = await requirePermission('opd.billing.read');
  const { id, billId } = await params;
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;

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
  for (const failed of [visit, tests]) {
    if (failed.status !== 'ok') {
      return (
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(failed))}
        </p>
      );
    }
  }
  if (visit.status !== 'ok' || tests.status !== 'ok') {
    return null;
  }

  const bill = tests.data.bills?.find((b) => b.id === billId) ?? null;
  if (!bill) {
    return (
      <EmptyState
        title={staffCopy.opd.receipt.notFoundTitle}
        description={staffCopy.opd.receipt.notFoundDescription}
      />
    );
  }

  return (
    <>
      {/* @page cannot use CSS variables reliably, so the size is injected from config. */}
      <style>{slipPageRule(opdWebConfig.receiptPaperSize, opdWebConfig.receiptPageMargin)}</style>
      {/* The tests receipt prints this bill, without the consultation token. */}
      <VisitReceipt visit={{ ...visit.data, bill, token: null }} hospitalName={hospitalName} />
    </>
  );
}
