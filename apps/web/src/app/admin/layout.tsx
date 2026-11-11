import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { hqConceptNavItems } from '@/mock/hq';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell title="Hospigo HQ" items={hqConceptNavItems}>
      {children}
    </AppShell>
  );
}
