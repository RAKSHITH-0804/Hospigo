import type { Metadata } from 'next';
import { NewVisitForm } from '@/components/opd/new-visit-form';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { API_OPD_DOCTORS } from '@/lib/opd/server';
import type { OpdDoctorsResponse } from '@/lib/opd/types';
import { errorMessageFor } from '@/lib/patients/client';
import { API_PATIENTS, fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import type { PatientDetail } from '@/lib/patients/types';

export const metadata: Metadata = { title: staffCopy.opd.newVisit.title };

export default async function NewVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('opd.visits.create');
  const { id } = await params;

  // Creating a visit also takes the money: both permissions are needed (the API checks again).
  if (!session.permissions?.includes('opd.billing.collect')) {
    return (
      <EmptyState
        title={staffCopy.opd.newVisit.noPermissionTitle}
        description={staffCopy.opd.newVisit.noPermissionDescription}
      />
    );
  }

  // Independent first-paint fetches run in parallel.
  const [patient, doctors] = await Promise.all([
    fetchStaffOnServer<PatientDetail>(`${API_PATIENTS}/${encodeURIComponent(id)}`),
    fetchStaffOnServer<OpdDoctorsResponse>(API_OPD_DOCTORS),
  ]);

  if (patient.status === 'notFound') {
    return (
      <EmptyState
        title={staffCopy.patients.record.notFoundTitle}
        description={staffCopy.patients.record.notFoundDescription}
      />
    );
  }
  if (patient.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(patient))}
      </p>
    );
  }
  if (doctors.status !== 'ok') {
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        <p className="type-label-strong">{staffCopy.opd.newVisit.doctorsErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(doctors))}
        </p>
      </div>
    );
  }

  return (
    <NewVisitForm
      patient={{ id: patient.data.id, name: patient.data.name, uhid: patient.data.uhid }}
      doctors={doctors.data.items}
    />
  );
}
