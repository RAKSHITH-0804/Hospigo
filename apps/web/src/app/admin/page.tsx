import type { Metadata } from 'next';
import { IndigoHospitals } from '@/components/admin/indigo-hospitals';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoOverview } from '@/lib/indigo/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.pageTitles.admin };

/** The real hospitals the signed-in Indigo person may see and enter (Steps 2.1b and 2.1e). */
export default async function AdminPage() {
  const result = await fetchStaffOnServer<IndigoOverview>('/indigo/hospitals');
  if (result.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(result))}
      </p>
    );
  }
  return <IndigoHospitals overview={result.data} />;
}
