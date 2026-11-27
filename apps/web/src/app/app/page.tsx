import type { Metadata } from 'next';
import { DashboardInsights } from '@/components/dashboard/dashboard-insights';
import { AllBranchesToggle } from '@/components/shell/all-branches-toggle';
import { QuickLinks } from '@/components/dashboard/quick-links';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';

export const metadata: Metadata = { title: staffCopy.pageTitles.dashboard };

export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string; branch?: string }>;
}) {
  const session = await requireKind('HOSPITAL');
  const params = searchParams ? await searchParams : undefined;
  const unavailable = params?.notice === 'module-unavailable';
  const noPermission = params?.notice === 'no-permission';
  const all = params?.branch === 'ALL' && session.canSwitchBranch === true;

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
      />
      {session.canSwitchBranch === true ? <AllBranchesToggle href="/app" active={all} /> : null}
      <DashboardInsights allBranches={all} permissions={session.permissions ?? []} />
    </div>
  );
}
