import type { Metadata } from 'next';
import { PatientForm } from '@/components/patients/patient-form';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import {
  API_PATIENT_FORM_CONFIG,
  fetchStaffOnServer,
  serverErrorCode,
} from '@/lib/patients/server';
import type { FormConfigResponse } from '@/lib/patients/types';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientRegister };

export default async function NewPatientPage() {
  await requirePermission('patients.registry.write');
  const config = await fetchStaffOnServer<FormConfigResponse>(API_PATIENT_FORM_CONFIG);

  return (
    <PatientForm
      mode="register"
      title={staffCopy.pageTitles.patientRegister}
      backHref="/app/patients"
      boot={
        config.status === 'ok'
          ? { fields: config.data.fields }
          : { failure: { code: serverErrorCode(config) } }
      }
    />
  );
}
