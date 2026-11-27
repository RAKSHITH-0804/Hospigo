import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';
import type { ShellNavItem } from '@/config/modules';

const indigoNav: ShellNavItem[] = [
  { href: '/admin', label: staffCopy.admin.console.navHospitals, icon: 'hospitals' },
  { href: '/admin/onboard', label: staffCopy.admin.console.navOnboard, icon: 'modules' },
  { href: '/admin/library', label: staffCopy.library.navLibrary, icon: 'modules' },
  { href: '/admin/terminology', label: staffCopy.terms.navTerms, icon: 'modules' },
  { href: '/admin/employees', label: staffCopy.admin.console.navEmployees, icon: 'staff' },
  { href: '/admin/activity', label: staffCopy.admin.hq.navActivity, icon: 'staff' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HQ');
  const roleCodes = session.roleCodes?.length ? session.roleCodes : ['HQ_ADMIN'];
  // HQ Staff never manage HQ Staff or read the activity log; onboarding is an HQ Admin page too
  const adminOnly = new Set(['/admin/onboard', '/admin/employees', '/admin/activity']);
  const nav = roleCodes.includes('HQ_ADMIN')
    ? indigoNav
    : indigoNav.filter((item) => !adminOnly.has(item.href));

  return (
    <div className="viewport-fill">
      <AppShell
        brandLabel={staffCopy.brand}
        title={staffCopy.hqTitle}
        groups={[{ label: '', items: nav }]}
        userDisplayName={session.displayName}
        userEmail={session.email}
        roleCodes={roleCodes}
        hospitalName={staffCopy.hqTitle}
      >
        {children}
      </AppShell>
    </div>
  );
}
