import type { Metadata } from 'next';
import { PatientSlip } from '@/components/patients/patient-slip';
import { PrintStage } from '@/components/print/print-sheet';
import { EmptyState } from '@/components/states/empty-state';
import { patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { errorMessageFor } from '@/lib/patients/client';
import { slipPageRule } from '@/lib/patients/format';
import {
  API_PATIENTS,
  API_PATIENT_FORM_CONFIG,
  fetchStaffOnServer,
  serverErrorCode,
} from '@/lib/patients/server';
import { relativeLine } from '@/lib/patients/relative';
import type { FormConfigResponse, PatientDetail } from '@/lib/patients/types';
import { slipItems, withExtraValues } from '@/lib/print/documents';
import {
  fetchLogoImageId,
  fetchPrintValues,
  fetchTemplate,
  readTemplate,
} from '@/lib/print/server';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientSlip };

export default async function PatientSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('patients.registry.read');
  const { id } = await params;
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;
  const [detail, templateResult, logoImageId, formConfig, extraValues] = await Promise.all([
    fetchStaffOnServer<PatientDetail>(`${API_PATIENTS}/${encodeURIComponent(id)}`),
    fetchTemplate('REGISTRATION_SLIP'),
    fetchLogoImageId(),
    fetchStaffOnServer<FormConfigResponse>(API_PATIENT_FORM_CONFIG),
    fetchPrintValues(),
  ]);
  const formFields = formConfig.status === 'ok' ? formConfig.data.fields : [];

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

  // The hospital's slip template decides the paper and layout; without a usable one (or when the
  // hospital switched it off) the older simple slip is shown.
  const template = readTemplate(templateResult);
  if (template?.enabled) {
    return (
      <PrintStage
        template={template}
        items={withExtraValues(
          slipItems(detail.data, session.activeBranchName ?? null, hospitalName, formFields),
          extraValues,
        )}
        images={{ LOGO: logoImageId }}
        title={staffCopy.patients.slip.title}
        backHref={`/app/patients/${encodeURIComponent(detail.data.id)}`}
        printLabel={staffCopy.patients.slip.print}
      />
    );
  }

  return (
    <>
      {/* @page cannot use CSS variables reliably, so the size is injected from config. */}
      <style>
        {slipPageRule(patientsWebConfig.slipPaperSize, patientsWebConfig.slipPageMargin)}
      </style>
      <PatientSlip
        patient={detail.data}
        hospitalName={hospitalName}
        relative={relativeLine(detail.data.customFieldValues, formFields)}
      />
    </>
  );
}
