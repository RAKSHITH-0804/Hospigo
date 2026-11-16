import type { Metadata } from 'next';
import { ComingLater } from '@/components/coming-later';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.dashboard };

export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const unavailable = params?.notice === 'module-unavailable';
  const noPermission = params?.notice === 'no-permission';

  return (
    <div className="stack gap-[var(--space-3)]">
      {unavailable ? (
        <p role="status" className="type-label text-destructive">
          {sessionConfig.errorModuleUnavailable}
        </p>
      ) : null}
      {noPermission ? (
        <p role="status" className="type-label text-destructive">
          {sessionConfig.errorNoPermission}
        </p>
      ) : null}
      <ComingLater title={staffCopy.pageTitles.dashboard} />
    </div>
  );
}
