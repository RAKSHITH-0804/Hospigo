import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { requireKind } from '@/lib/auth/guards';
import { hqConceptNavItems } from '@/mock/hq';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireKind('HQ');
  return (
    <AppShell title="Hospigo HQ" items={hqConceptNavItems} userDisplayName={session.displayName}>
      {children}
    </AppShell>
  );
}
