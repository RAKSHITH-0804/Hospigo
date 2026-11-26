import type { Metadata } from 'next';
import { IndigoTerminology } from '@/components/admin/indigo-terminology';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoOverview } from '@/lib/indigo/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.terms.consoleTitle };

export default async function TerminologyPage() {
  const overview = await fetchStaffOnServer<IndigoOverview>('/indigo/hospitals');
  if (overview.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(overview))}
      </p>
    );
  }
  return (
    <IndigoTerminology hospitals={overview.data.items.map((h) => ({ id: h.id, name: h.name }))} />
  );
}
