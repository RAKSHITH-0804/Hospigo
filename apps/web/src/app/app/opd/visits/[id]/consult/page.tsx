import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConsultScreen } from '@/components/opd/consult-screen';
import { PreviousVisits } from '@/components/opd/previous-visits';
import { EmptyState } from '@/components/states/empty-state';
import { SkeletonBlock } from '@/components/states/skeletons';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import type { ConsultationResponse, VitalsResponse } from '@/lib/opd/clinical-types';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import { apiConsultationPath, apiVisitTestsPath, apiVisitVitalsPath } from '@/lib/opd/server';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

const copy = staffCopy.opd.clinical;
const QUEUE_PATH = '/app/opd';

export const metadata: Metadata = { title: staffCopy.pageTitles.opdConsult };

export default async function ConsultPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('opd.notes.read');
  const { id } = await params;
  const permissions = session.permissions ?? [];

  // The note (this read is audited by the API) and the vitals are fetched in parallel.
  const canOrderTests = permissions.includes('opd.investigations.order');
  const [consult, vitals, tests] = await Promise.all([
    fetchStaffOnServer<ConsultationResponse>(apiConsultationPath(id)),
    permissions.includes('opd.vitals.read')
      ? fetchStaffOnServer<VitalsResponse>(apiVisitVitalsPath(id))
      : Promise.resolve(null),
    canOrderTests
      ? fetchStaffOnServer<VisitTestsResponse>(apiVisitTestsPath(id))
      : Promise.resolve(null),
  ]);

  if (consult.status === 'notFound') {
    return (
      <EmptyState title={copy.vitals.notFoundTitle} description={copy.vitals.notFoundDescription} />
    );
  }
  if (consult.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(consult))}
      </p>
    );
  }

  return (
    <ConsultScreen
      initial={consult.data}
      vitals={vitals && vitals.status === 'ok' ? vitals.data.fields : []}
      canWrite={permissions.includes('opd.notes.write')}
      canRecordVitals={permissions.includes('opd.vitals.write')}
      canAmend={permissions.includes('opd.notes.amend')}
      canOrderTests={canOrderTests}
      initialTests={tests && tests.status === 'ok' ? tests.data.orders : []}
      settings={{
        autosaveSeconds: opdWebConfig.autosaveSeconds,
        minChars: opdWebConfig.medicineSearchMinChars,
        debounceMs: opdWebConfig.medicineSearchDebounceMs,
        limit: opdWebConfig.medicineSearchLimit,
        calendarWeekStart: opdWebConfig.calendarWeekStart,
        followUpQuickDays: opdWebConfig.followUpQuickDays,
        testsSearch: {
          minChars: opdWebConfig.testsSearchMinChars,
          debounceMs: opdWebConfig.testsSearchDebounceMs,
          limit: opdWebConfig.testsSearchLimit,
        },
      }}
      backHref={QUEUE_PATH}
    >
      {/* Streams in after the screen: it never slows the first paint. */}
      <Suspense fallback={<SkeletonBlock className="skeleton-row" />}>
        <PreviousVisits
          patientId={consult.data.visit.patient.id}
          currentVisitId={consult.data.visit.id}
        />
      </Suspense>
    </ConsultScreen>
  );
}
