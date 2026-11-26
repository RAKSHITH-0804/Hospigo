import type { Metadata } from 'next';
import { PrintStage } from '@/components/print/print-sheet';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { errorMessageFor } from '@/lib/patients/client';
import {
  API_PATIENTS,
  API_PATIENT_FORM_CONFIG,
  fetchStaffOnServer,
  serverErrorCode,
} from '@/lib/patients/server';
import type { FormConfigResponse, PatientDetail } from '@/lib/patients/types';
import { patientCardItems, withExtraValues } from '@/lib/print/documents';
import {
  fetchLogoImageId,
  fetchPrintValues,
  fetchTemplate,
  readTemplate,
} from '@/lib/print/server';

const copy = staffCopy.print.patientCard;

export const metadata: Metadata = { title: copy.pageTitle };

/**
 * The patient card: a small gummed label for the patient file. It prints through the hospital's
 * patient card template (paper size 50 x 100 mm by default) with the normal browser print or the
 * Windows printer driver. `?auto=1` opens the print window by itself (the receipt page sends the
 * receptionist here after payment when the hospital has switched that on).
 */
export default async function PatientCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const session = await requirePermission('patients.registry.read');
  const { id } = await params;
  const { auto } = await searchParams;
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;
  const [detail, templateResult, logoImageId, formConfig, extraValues] = await Promise.all([
    fetchStaffOnServer<PatientDetail>(`${API_PATIENTS}/${encodeURIComponent(id)}`),
    fetchTemplate('PATIENT_CARD'),
    fetchLogoImageId(),
    fetchStaffOnServer<FormConfigResponse>(API_PATIENT_FORM_CONFIG),
    fetchPrintValues(),
  ]);
  const formFields = formConfig.status === 'ok' ? formConfig.data.fields : [];

  if (detail.status === 'notFound') {
    return <EmptyState title={copy.notFoundTitle} description={copy.notFoundDescription} />;
  }
  if (detail.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(detail))}
      </p>
    );
  }
  const template = readTemplate(templateResult);
  if (!template) {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(
          templateResult.status === 'ok' ? 'UNKNOWN' : serverErrorCode(templateResult),
        )}
      </p>
    );
  }
  if (!template.enabled) {
    return <EmptyState title={copy.switchedOffTitle} description={copy.switchedOffDescription} />;
  }
  return (
    <PrintStage
      template={template}
      items={withExtraValues(patientCardItems(detail.data, hospitalName, formFields), extraValues)}
      images={{ LOGO: logoImageId }}
      title={copy.title}
      description={`${detail.data.name} · ${detail.data.uhid}`}
      backHref={`/app/patients/${encodeURIComponent(detail.data.id)}`}
      printLabel={copy.print}
      autoPrint={auto === '1'}
    />
  );
}
