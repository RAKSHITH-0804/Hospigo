import type { ReactNode } from 'react';
import { BrandScope } from '@/components/brand-scope';
import { AppShell, BranchSwitcherPlaceholder } from '@/components/shell/app-shell';
import { requireKind } from '@/lib/auth/guards';
import { demoStaffHospital, staffNavFromModules } from '@/mock/hospital-app';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HOSPITAL');
  return (
    <BrandScope brandColor={demoStaffHospital.brandColor}>
      <AppShell
        title={demoStaffHospital.name}
        items={staffNavFromModules()}
        branchSwitcher={<BranchSwitcherPlaceholder />}
        sidebarFooter="Powered by Hospigo"
        userDisplayName={session.displayName}
      >
        {children}
      </AppShell>
    </BrandScope>
  );
}
