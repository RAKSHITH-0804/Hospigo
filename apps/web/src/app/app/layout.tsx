import type { ReactNode } from 'react';
import { AppShell, BranchSwitcherPlaceholder } from '@/components/shell/app-shell';
import { staffNavItems } from '@/mock/navigation';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      title="Hospital staff"
      items={staffNavItems}
      branchSwitcher={<BranchSwitcherPlaceholder />}
    >
      {children}
    </AppShell>
  );
}
