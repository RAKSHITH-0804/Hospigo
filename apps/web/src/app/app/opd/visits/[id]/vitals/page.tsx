import type { Metadata } from 'next';
import { VitalsForm } from '@/components/opd/vitals-form';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import type { VitalsFieldsResponse, VitalsResponse } from '@/lib/opd/clinical-types';
import { API_OPD_VITALS_FIELDS, apiVisitVitalsPath } from '@/lib/opd/server';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

const copy = staffCopy.opd.clinical.vitals;
const QUEUE_PATH = '/app/opd';

export const metadata: Metadata = { title: staffCopy.pageTitles.opdVitals };

export default async function VisitVitalsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('opd.vitals.read');
  const { id } = await params;

  // Independent first-paint fetches run in parallel.
  const [vitals, fields] = await Promise.all([
    fetchStaffOnServer<VitalsResponse>(apiVisitVitalsPath(id)),
    fetchStaffOnServer<VitalsFieldsResponse>(API_OPD_VITALS_FIELDS),
  ]);

  if (vitals.status === 'notFound') {
    return <EmptyState title={copy.notFoundTitle} description={copy.notFoundDescription} />;
  }
  if (vitals.status !== 'ok' || fields.status !== 'ok') {
    const failed = vitals.status !== 'ok' ? vitals : fields;
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        <p className="type-label-strong">{copy.errorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(failed.status === 'ok' ? 'UNKNOWN' : serverErrorCode(failed))}
        </p>
      </div>
    );
  }

  return (
    <VitalsForm
      visit={vitals.data.visit}
      fields={fields.data.items}
      initial={vitals.data.fields}
      canWrite={session.permissions?.includes('opd.vitals.write') ?? false}
      backHref={QUEUE_PATH}
    />
  );
}
