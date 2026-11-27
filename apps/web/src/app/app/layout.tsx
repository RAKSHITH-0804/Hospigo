import type { ReactNode } from 'react';
import { PendingApprovalsProvider } from '@/components/opd/pending-approvals';
import { PendingLeaveProvider } from '@/components/opd/pending-leave';
import { AppShell } from '@/components/shell/app-shell';
import { shellNavFromEnabledModules, type ShellNavItem } from '@/config/modules';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';
import { hospitalTerms, termOr } from '@/lib/terminology/server';
import { enterTerms } from '@/lib/terminology/terms-server';
import { TermsProvider } from '@/components/shell/terms-provider';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HOSPITAL');
  // the hospital's own words for a few menu entries (Indigo sets them; standard words otherwise)
  const terms = await hospitalTerms(session.id);
  enterTerms(terms);
  const moduleItems = shellNavFromEnabledModules(session.enabledModules ?? []).map((item) =>
    item.href === '/app/opd' ? { ...item, label: termOr(terms, 'queue', item.label) } : item,
  );
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
      label: termOr(terms, 'patients', staffCopy.nav.patients),
      icon: 'patients',
    });
  }
  navItems.push(...modules);
  if (
    ['user.read', 'role.read', 'opd.doctors.read'].some((p) => session.permissions?.includes(p))
  ) {
    navItems.push({
      href: '/app/administration',
      label: staffCopy.nav.administration,
      icon: 'staff',
    });
  }
  if (session.permissions?.includes('hospital.settings.read')) {
    navItems.push({
      href: '/app/settings',
      label: staffCopy.nav.settings,
      icon: 'settings',
    });
  }

  const canDecideLeave = (session.permissions ?? []).includes('opd.doctors.write');
  const canApprove = (session.permissions ?? []).includes('opd.refunds.approve');
  const hospitalTitle = session.hospitalName?.trim() || staffCopy.brand;
  const branchName = session.activeBranchName?.trim() || '—';

  return (
    <TermsProvider terms={terms}>
      <PendingApprovalsProvider enabled={canApprove}>
        <PendingLeaveProvider enabled={canDecideLeave}>
          <div className="viewport-fill">
            <AppShell
              brandLabel={staffCopy.brand}
              title={hospitalTitle}
              groups={[{ label: '', items: navItems }]}
              branchName={branchName}
              activeBranchId={session.activeBranchId}
              canSwitchBranch={session.canSwitchBranch === true}
              userDisplayName={session.displayName}
              userEmail={session.email}
              roleCodes={session.roleCodes ?? []}
              hospitalName={hospitalTitle}
              profileHref="/app/profile"
              canApprove={canApprove}
            >
              {children}
            </AppShell>
          </div>
        </PendingLeaveProvider>
      </PendingApprovalsProvider>
    </TermsProvider>
  );
}
