import type { Metadata } from 'next';
import { PatientForm, type PatientFormBoot } from '@/components/patients/patient-form';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import {
  API_PATIENT_FORM_CONFIG,
  API_PATIENTS,
  fetchStaffOnServer,
  serverErrorCode,
} from '@/lib/patients/server';
import type { FormConfigResponse, PatientDetail } from '@/lib/patients/types';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientEdit };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('patients.registry.write');
  const { id } = await params;

  // Independent fetches run in parallel.
  const [config, detail] = await Promise.all([
    fetchStaffOnServer<FormConfigResponse>(API_PATIENT_FORM_CONFIG),
    fetchStaffOnServer<PatientDetail>(`${API_PATIENTS}/${encodeURIComponent(id)}`),
  ]);

  let boot: PatientFormBoot;
  if (config.status !== 'ok') {
    boot = { failure: { code: serverErrorCode(config) } };
  } else if (detail.status === 'notFound') {
    boot = { failure: 'notFound' };
  } else if (detail.status !== 'ok') {
    boot = { failure: { code: serverErrorCode(detail) } };
  } else {
    boot = { fields: config.data.fields, detail: detail.data };
  }

  return (
    <PatientForm
      mode="edit"
      patientId={id}
      title={staffCopy.pageTitles.patientEdit}
      backHref={`/app/patients/${encodeURIComponent(id)}`}
      boot={boot}
    />
  );
}
