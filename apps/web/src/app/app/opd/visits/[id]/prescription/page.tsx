import type { Metadata } from 'next';
import { PrintStage } from '@/components/print/print-sheet';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import type { ConsultationResponse } from '@/lib/opd/clinical-types';
import { apiConsultationPath } from '@/lib/opd/server';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import { prescriptionItems, withExtraValues } from '@/lib/print/documents';
import {
  fetchLogoImageId,
  fetchPrintValues,
  fetchTemplate,
  readTemplate,
} from '@/lib/print/server';

const copy = staffCopy.print.prescription;

export const metadata: Metadata = { title: copy.pageTitle };

/**
 * The prescription of a COMPLETED consultation: the slim document that goes to the pharmacy (header,
 * the medicines the doctor entered, the signature). It prints through the hospital's prescription
 * template. The patient's own full copy is the patient report.
 */
export default async function PrescriptionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission('opd.notes.read');
  const { id } = await params;
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;

  const [consult, templateResult, logoImageId, extraValues] = await Promise.all([
    fetchStaffOnServer<ConsultationResponse>(apiConsultationPath(id)),
    fetchTemplate('PRESCRIPTION'),
    fetchLogoImageId(),
    fetchPrintValues(),
  ]);

  if (consult.status === 'notFound') {
    return <EmptyState title={copy.notFoundTitle} description={copy.notFoundDescription} />;
  }
  if (consult.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(consult))}
      </p>
    );
  }
  if (
    consult.data.visit.status !== 'COMPLETED' ||
    consult.data.consultation?.status !== 'COMPLETED'
  ) {
    return <EmptyState title={copy.notReadyTitle} description={copy.notReadyDescription} />;
  }

  const template = readTemplate(templateResult);
  if (!template) {
    // There is no older simple prescription printout: say so calmly instead of printing nothing.
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
      items={withExtraValues(
        prescriptionItems({
          hospitalName,
          consultation: consult.data,
          amended: consult.data.consultation?.amended === true,
        }),
        extraValues,
      )}
      // the signature is the one the doctor had when the note was completed, never a newer one
      images={{
        LOGO: logoImageId,
        SIGNATURE: consult.data.doctorDetails?.signatureImageId ?? null,
      }}
      title={copy.pageTitle}
      description={`${consult.data.visit.patient.name} · ${consult.data.visit.patient.uhid}`}
      backHref={`/app/opd/visits/${encodeURIComponent(id)}/consult`}
      printLabel={copy.print}
    />
  );
}
