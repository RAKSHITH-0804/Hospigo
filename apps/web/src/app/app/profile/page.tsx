import type { Metadata } from 'next';
import { MyProfileForm } from '@/components/doctors/my-profile-form';
import { EmptyState } from '@/components/states/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { API_DOCTOR_PROFILE_ME, type MyProfileResponse } from '@/lib/doctors/types';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

const copy = staffCopy.doctorProfile;

export const metadata: Metadata = { title: copy.pageTitle };

/**
 * "My profile": the doctor's own printed name, qualifications, speciality and registration number.
 * The API finds the profile from the signed-in user. A login without a doctor profile gets a calm
 * message, not a form.
 */
export default async function MyProfilePage() {
  await requirePermission('opd.doctors.own');
  const result = await fetchStaffOnServer<MyProfileResponse>(API_DOCTOR_PROFILE_ME);
  if (result.status === 'forbidden') {
    return (
      <div className="section-stack content-container-inner">
        <EmptyState title={copy.noProfileTitle} description={copy.noProfileDescription} />
      </div>
    );
  }
  return (
    <div className="section-stack content-container-inner">
      <PageHeader title={copy.title} description={copy.description} backToPrevious="/app" />
      <MyProfileForm
        initial={result.status === 'ok' ? result.data : null}
        initialErrorCode={result.status === 'ok' ? null : serverErrorCode(result)}
      />
    </div>
  );
}
