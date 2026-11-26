import type { Metadata } from 'next';
import { IndigoLibrary } from '@/components/admin/indigo-library';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoOverview } from '@/lib/indigo/types';
import type { LibraryOverview } from '@/lib/indigo/library';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.library.consoleTitle };

export default async function LibraryPage() {
  const [overview, library] = await Promise.all([
    fetchStaffOnServer<IndigoOverview>('/indigo/hospitals'),
    fetchStaffOnServer<LibraryOverview>('/indigo/library'),
  ]);
  if (overview.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(overview))}
      </p>
    );
  }
  if (library.status !== 'ok') {
    return <p className="type-label">{staffCopy.admin.console.ownerOnly}</p>;
  }
  return (
    <IndigoLibrary
      overview={library.data}
      hospitals={overview.data.items.map((h) => ({ id: h.id, name: h.name }))}
    />
  );
}
