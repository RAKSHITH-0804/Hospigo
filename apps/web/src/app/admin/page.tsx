import type { Metadata } from 'next';
import { IndigoHospitals, type IndigoHospital } from '@/components/admin/indigo-hospitals';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.pageTitles.admin };

/** The real hospitals the signed-in Indigo person may enter (Step 2.1b). */
export default async function AdminPage() {
  const result = await fetchStaffOnServer<{ items: IndigoHospital[] }>('/auth/indigo/hospitals');
  if (result.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(result))}
      </p>
    );
  }
  return <IndigoHospitals hospitals={result.data.items} />;
}
