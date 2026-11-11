import type { ReactNode } from 'react';
import { BrandScope } from '@/components/brand-scope';
import { AppShell, BranchSwitcherPlaceholder } from '@/components/shell/app-shell';
import { demoStaffHospital, staffNavFromModules } from '@/mock/hospital-app';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <BrandScope brandColor={demoStaffHospital.brandColor}>
      <AppShell
        title={demoStaffHospital.name}
        items={staffNavFromModules()}
        branchSwitcher={<BranchSwitcherPlaceholder />}
        sidebarFooter="Powered by Hospigo"
      >
        {children}
      </AppShell>
    </BrandScope>
  );
}
