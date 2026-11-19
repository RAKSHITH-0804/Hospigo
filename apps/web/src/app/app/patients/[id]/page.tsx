import type { Metadata } from 'next';
import { PatientRecord } from '@/components/patients/patient-record';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { opdWebConfig } from '@/config/opd';
import { opdErrorMessageFor } from '@/lib/opd/client';
import { apiPatientVisitsPath } from '@/lib/opd/server';
import type { VisitListResponse, VisitsTabData } from '@/lib/opd/types';
import { errorMessageFor } from '@/lib/patients/client';
import {
  API_PATIENT_FORM_CONFIG,
  API_PATIENTS,
  fetchStaffOnServer,
  serverErrorCode,
} from '@/lib/patients/server';
import type { FormConfigResponse, PatientDetail } from '@/lib/patients/types';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientRecord };

export default async function PatientRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission('patients.registry.read');
  const { id } = await params;
  const canWrite = session.permissions?.includes('patients.registry.write') ?? false;
  const permissions = session.permissions ?? [];
  const canReadVisits = permissions.includes('opd.visits.read');
  const canReadBills = permissions.includes('opd.billing.read');
  const canCreateVisit =
    permissions.includes('opd.visits.create') && permissions.includes('opd.billing.collect');
  const query = (await searchParams) ?? {};
  const rawPage = Number(
    Array.isArray(query[opdWebConfig.visitsPageParam])
      ? undefined
      : query[opdWebConfig.visitsPageParam],
  );
  const visitsPage = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const initialTab = typeof query.tab === 'string' ? query.tab : undefined;

  // Independent fetches run in parallel (one wait, not two).
  const [detail, config, visits] = await Promise.all([
    fetchStaffOnServer<PatientDetail>(`${API_PATIENTS}/${encodeURIComponent(id)}`),
    fetchStaffOnServer<FormConfigResponse>(API_PATIENT_FORM_CONFIG),
    canReadVisits
      ? fetchStaffOnServer<VisitListResponse>(apiPatientVisitsPath(id), {
          page: visitsPage,
          pageSize: opdWebConfig.visitsPageSize,
        })
      : Promise.resolve(null),
  ]);

  let visitsTab: VisitsTabData = { status: 'noAccess' };
  if (visits) {
    visitsTab =
      visits.status === 'ok'
        ? { status: 'ok', data: visits.data }
        : visits.status === 'forbidden'
          ? { status: 'noAccess' }
          : { status: 'error', message: opdErrorMessageFor(serverErrorCode(visits)) };
  }

  if (detail.status === 'notFound') {
    return (
      <EmptyState
        title={staffCopy.patients.record.notFoundTitle}
        description={staffCopy.patients.record.notFoundDescription}
      />
    );
  }
  if (detail.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(detail))}
      </p>
    );
  }

  const labels: Record<string, string> = {};
  if (config.status === 'ok') {
    for (const field of config.data.fields ?? []) {
      if (field.code) {
        labels[field.code] = field.label;
      }
    }
  }

  return (
    <PatientRecord
      patient={detail.data}
      labels={labels}
      canWrite={canWrite}
      canCreateVisit={canCreateVisit}
      canReadBills={canReadBills}
      canRequestRefund={permissions.includes('opd.refunds.request')}
      canSeeTests={permissions.includes('opd.investigations.bill')}
      visitsTab={visitsTab}
      initialTab={initialTab}
    />
  );
}
