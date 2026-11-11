import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { hqNavItems } from '@/mock/navigation';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell title="Indigo HQ" items={hqNavItems}>
      {children}
    </AppShell>
  );
}
