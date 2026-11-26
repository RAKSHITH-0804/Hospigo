import type { Metadata } from 'next';
import { OnboardHospital } from '@/components/admin/onboard-hospital';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoOverview } from '@/lib/indigo/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.admin.console.onboardTitle };

export default async function OnboardPage() {
  const result = await fetchStaffOnServer<IndigoOverview>('/indigo/hospitals');
  if (result.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(result))}
      </p>
    );
  }
  if (!result.data.canManage) {
    return <p className="type-label">{staffCopy.admin.console.ownerOnly}</p>;
  }
  return <OnboardHospital moduleCatalog={result.data.moduleCatalog} />;
}
