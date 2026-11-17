import type { Metadata } from 'next';
import { PatientRecord } from '@/components/patients/patient-record';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { errorMessageFor } from '@/lib/patients/client';
import {
  API_PATIENT_FORM_CONFIG,
  API_PATIENTS,
  fetchStaffOnServer,
  serverErrorCode,
} from '@/lib/patients/server';
import type { FormConfigResponse, PatientDetail } from '@/lib/patients/types';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientRecord };

export default async function PatientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('patients.registry.read');
  const { id } = await params;
  const canWrite = session.permissions?.includes('patients.registry.write') ?? false;

  // Independent fetches run in parallel (one wait, not two).
  const [detail, config] = await Promise.all([
    fetchStaffOnServer<PatientDetail>(`${API_PATIENTS}/${encodeURIComponent(id)}`),
    fetchStaffOnServer<FormConfigResponse>(API_PATIENT_FORM_CONFIG),
  ]);

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

  return <PatientRecord patient={detail.data} labels={labels} canWrite={canWrite} />;
}
