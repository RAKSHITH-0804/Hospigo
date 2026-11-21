import type { Metadata } from 'next';
import { VisitReceipt } from '@/components/opd/visit-receipt';
import { PrintStage } from '@/components/print/print-sheet';
import { EmptyState } from '@/components/states/empty-state';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { apiVisitPath } from '@/lib/opd/server';
import type { VisitView } from '@/lib/opd/types';
import { errorMessageFor } from '@/lib/patients/client';
import { slipPageRule } from '@/lib/patients/format';
import { receiptItems } from '@/lib/print/documents';
import { fetchTemplate, readTemplate } from '@/lib/print/server';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.opd.receipt.pageTitle };

export default async function VisitReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('opd.visits.read');
  const { id } = await params;
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;
  const [visit, templateResult] = await Promise.all([
    fetchStaffOnServer<VisitView>(apiVisitPath(id)),
    fetchTemplate('RECEIPT'),
  ]);

  if (visit.status === 'notFound') {
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

  // The hospital's receipt template decides the paper and layout. Without a usable template (or
  // when the hospital switched it off, or there is no bill) the older simple receipt is shown.
  const template = readTemplate(templateResult);
  if (template?.enabled && visit.data.bill) {
    return (
      <PrintStage
        template={template}
        items={receiptItems(visit.data, hospitalName)}
        title={staffCopy.opd.receipt.title}
        description={`${visit.data.patient.name} · ${visit.data.patient.uhid}`}
        backHref={`/app/patients/${encodeURIComponent(visit.data.patient.id)}`}
        printLabel={staffCopy.opd.receipt.print}
      />
    );
  }

  return (
    <>
      {/* @page cannot use CSS variables reliably, so the size is injected from config. */}
      <style>{slipPageRule(opdWebConfig.receiptPaperSize, opdWebConfig.receiptPageMargin)}</style>
      <VisitReceipt visit={visit.data} hospitalName={hospitalName} />
    </>
  );
}
