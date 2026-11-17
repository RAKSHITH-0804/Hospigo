import type { Metadata } from 'next';
import { PatientSlip } from '@/components/patients/patient-slip';
import { EmptyState } from '@/components/states/empty-state';
import { patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { errorMessageFor } from '@/lib/patients/client';
import { slipPageRule } from '@/lib/patients/format';
import { API_PATIENTS, fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import type { PatientDetail } from '@/lib/patients/types';

export const metadata: Metadata = { title: staffCopy.pageTitles.patientSlip };

export default async function PatientSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('patients.registry.read');
  const { id } = await params;
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;
  const detail = await fetchStaffOnServer<PatientDetail>(
    `${API_PATIENTS}/${encodeURIComponent(id)}`,
  );

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

  return (
    <>
      {/* @page cannot use CSS variables reliably, so the size is injected from config. */}
      <style>
        {slipPageRule(patientsWebConfig.slipPaperSize, patientsWebConfig.slipPageMargin)}
      </style>
      <PatientSlip patient={detail.data} hospitalName={hospitalName} />
    </>
  );
}
