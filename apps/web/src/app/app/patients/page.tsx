import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';

export const metadata: Metadata = { title: staffCopy.pageTitles.patients };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requirePermission('patients.registry.read');
  // q is accepted from the top-bar search form; ignored until Step 3c.
  await searchParams;

  return (
    <div className="stack gap-[var(--space-4)]">
      <PageHeader title={staffCopy.patients.title} description={staffCopy.patients.description} />
      <EmptyState
        title={staffCopy.patients.emptyTitle}
        description={staffCopy.patients.emptyDescription}
      />
    </div>
  );
}
