import type { Metadata } from 'next';
import { QuickLinks } from '@/components/dashboard/quick-links';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';

export const metadata: Metadata = { title: staffCopy.pageTitles.dashboard };

export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const session = await requireKind('HOSPITAL');
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
      <QuickLinks
        displayName={session.displayName}
        branchName={session.activeBranchName?.trim() || '—'}
        hospitalName={session.hospitalName?.trim() || staffCopy.brand}
        permissions={session.permissions}
      />
    </div>
  );
}
