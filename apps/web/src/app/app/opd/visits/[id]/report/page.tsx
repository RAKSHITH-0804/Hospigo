import type { Metadata } from 'next';
import { PrintStage } from '@/components/print/print-sheet';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { fetchClinicalForPrint, requireClinicalPrint } from '@/lib/opd/print-access';
import { apiVisitTestsPath } from '@/lib/opd/server';
import type { VisitTestsResponse } from '@/lib/opd/tests-types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import { patientReportItems, withExtraValues } from '@/lib/print/documents';
import {
  fetchLogoImageId,
  fetchPrintValues,
  fetchTemplate,
  readTemplate,
} from '@/lib/print/server';

const copy = staffCopy.print.patientReport;

export const metadata: Metadata = { title: copy.pageTitle };

/**
 * The patient report: the patient's own copy of a COMPLETED consultation, with everything (vitals,
 * symptoms, diagnosis, medicines, tests, advice). It prints through the hospital's patient report
 * template. Vitals and ordered tests are added when the person may read them; the API decides access.
 * The slim prescription for the pharmacy is a separate document.
 */
export default async function PatientReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const session = await requireClinicalPrint();
  const { id } = await params;
  // a person who came from the queue (or who may only print) goes back to the queue, not to the notes
  const fromQueue =
    (await searchParams)?.from === 'queue' ||
    !(session.permissions ?? []).includes('opd.notes.read');
  const permissions = session.permissions ?? [];
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;

  const [{ consult, vitals }, tests, templateResult, logoImageId, extraValues] = await Promise.all([
    fetchClinicalForPrint(id, permissions),
    permissions.includes('opd.investigations.order')
      ? fetchStaffOnServer<VisitTestsResponse>(apiVisitTestsPath(id))
      : Promise.resolve(null),
    fetchTemplate('PATIENT_REPORT'),
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
        patientReportItems({
          hospitalName,
          consultation: consult.data,
          amended: consult.data.consultation?.amended === true,
          vitals: vitals?.status === 'ok' ? vitals.data : null,
          tests: tests?.status === 'ok' ? tests.data : null,
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
      backHref={fromQueue ? '/app/opd' : `/app/opd/visits/${encodeURIComponent(id)}/consult`}
      printLabel={copy.print}
    />
  );
}
