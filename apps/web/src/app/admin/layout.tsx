import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';
import type { ShellNavItem } from '@/config/modules';

const indigoNav: ShellNavItem[] = [
  { href: '/admin', label: staffCopy.admin.console.navHospitals, icon: 'hospitals' },
  { href: '/admin/onboard', label: staffCopy.admin.console.navOnboard, icon: 'modules' },
  { href: '/admin/employees', label: staffCopy.admin.console.navEmployees, icon: 'staff' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HQ');
  const roleCodes = session.roleCodes?.length ? session.roleCodes : ['HQ_ADMIN'];

  return (
    <div className="viewport-fill">
      <AppShell
        brandLabel={staffCopy.brand}
        title={staffCopy.hqTitle}
        groups={[{ label: '', items: indigoNav }]}
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
