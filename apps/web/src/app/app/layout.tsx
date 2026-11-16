import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { shellNavFromEnabledModules, type ShellNavItem } from '@/config/modules';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HOSPITAL');
  const moduleItems = shellNavFromEnabledModules(session.enabledModules ?? []);
  const navItems: ShellNavItem[] = [...moduleItems];
  if (session.permissions?.includes('patients.registry.read')) {
    navItems.unshift({
      href: '/app/patients',
      label: staffCopy.nav.patients,
      icon: 'patients',
    });
  }
  if (session.permissions?.includes('hospital.settings.read')) {
    navItems.push({
      href: '/app/settings',
      label: staffCopy.nav.settings,
      icon: 'settings',
    });
  }

  const hospitalTitle = session.hospitalName?.trim() || staffCopy.brand;
  const branchName = session.activeBranchName?.trim() || '—';

  return (
    <div className="viewport-fill">
      <AppShell
        brandLabel={staffCopy.brand}
        title={hospitalTitle}
        groups={[{ label: '', items: navItems }]}
        branchName={branchName}
        showPatientSearch={session.permissions?.includes('patients.registry.read')}
        userDisplayName={session.displayName}
        userEmail={session.email}
        roleCodes={session.roleCodes ?? []}
        hospitalName={hospitalTitle}
      >
        {children}
      </AppShell>
    </div>
  );
}
