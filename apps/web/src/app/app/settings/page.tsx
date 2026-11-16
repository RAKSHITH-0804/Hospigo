import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';

export const metadata: Metadata = { title: staffCopy.pageTitles.settings };

export default async function SettingsPage() {
  await requirePermission('hospital.settings.read');

  return (
    <div className="stack gap-[var(--space-4)]">
      <PageHeader title={staffCopy.settings.title} description={staffCopy.settings.description} />
      <EmptyState
        title={staffCopy.settings.emptyTitle}
        description={staffCopy.settings.emptyDescription}
      />
    </div>
  );
}
