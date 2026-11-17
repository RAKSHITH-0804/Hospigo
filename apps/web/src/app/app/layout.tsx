import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { shellNavFromEnabledModules, type ShellNavItem } from '@/config/modules';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HOSPITAL');
  const moduleItems = shellNavFromEnabledModules(session.enabledModules ?? []);
  // Dashboard first, then Patients, then clinical modules, then Settings last.
  const dashboard = moduleItems.find((item) => item.href === '/app');
  const modules = moduleItems.filter((item) => item.href !== '/app');
  const navItems: ShellNavItem[] = [];
  if (dashboard) {
    navItems.push(dashboard);
  }
  if (session.permissions?.includes('patients.registry.read')) {
    navItems.push({
      href: '/app/patients',
      label: staffCopy.nav.patients,
      icon: 'patients',
    });
  }
  navItems.push(...modules);
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
