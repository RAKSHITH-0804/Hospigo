import type { ReactNode } from 'react';
import { AppShell, ActiveBranchLabel } from '@/components/shell/app-shell';
import { shellNavFromEnabledModules } from '@/config/modules';
import { requireKind } from '@/lib/auth/guards';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HOSPITAL');
  const items = shellNavFromEnabledModules(session.enabledModules ?? []);
  const hospitalTitle = session.hospitalName?.trim() || 'Hospital';
  const branchName = session.activeBranchName?.trim() || 'Branch';

  return (
    <div className="viewport-fill">
      <AppShell
        title={hospitalTitle}
        items={items}
        branchSwitcher={<ActiveBranchLabel name={branchName} />}
        sidebarFooter="Powered by Hospigo"
        userDisplayName={session.displayName}
      >
        {children}
      </AppShell>
    </div>
  );
}
