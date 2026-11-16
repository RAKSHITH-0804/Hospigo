import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';
import { hqConceptNavItems } from '@/mock/hq';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HQ');
  const roleCodes = session.roleCodes?.length ? session.roleCodes : ['HQ_ADMIN'];

  return (
    <div className="viewport-fill">
      <AppShell
        brandLabel={staffCopy.brand}
        title={staffCopy.hqTitle}
        groups={[{ label: '', items: hqConceptNavItems }]}
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
