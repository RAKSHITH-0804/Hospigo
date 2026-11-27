import type { Metadata } from 'next';
import { HqDesigner } from '@/components/admin/hq-designer';
import { staffCopy } from '@/config/staff-copy';
import type { PrintTemplate } from '@/lib/print/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.library.consoleTitle };

/** The HQ designer for one library template (HQ Staff need the print designs tick). */
export default async function DesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await fetchStaffOnServer<{ id: string; name: string; template: PrintTemplate }>(
    `/indigo/library/templates/${encodeURIComponent(id)}`,
  );
  if (result.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(result))}
      </p>
    );
  }
  return <HqDesigner id={result.data.id} name={result.data.name} template={result.data.template} />;
}
