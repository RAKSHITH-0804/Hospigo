import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OpdTabs, type OpdTabItem } from '@/components/opd/opd-tabs';
import { staffCopy } from '@/config/staff-copy';
import { requireModule } from '@/lib/auth/module-guard';

export const metadata: Metadata = { title: staffCopy.pageTitles.opd };

export default async function OpdLayout({ children }: { children: ReactNode }) {
  const session = await requireModule('OPD');
  const permissions = session.permissions ?? [];
  const nav = staffCopy.opd.tests.nav;

  // Each section appears only for staff who may use it (the API still decides on every call).
  const items: OpdTabItem[] = [];
  if (permissions.includes('opd.queue.read')) {
    items.push({ href: '/app/opd', label: nav.queue });
  }
  if (
    permissions.includes('opd.investigations.bill') &&
    permissions.includes('opd.billing.collect')
  ) {
    items.push({ href: '/app/opd/tests', label: nav.tests });
  }
  if (permissions.includes('opd.billing.read')) {
    items.push({ href: '/app/opd/refunds', label: nav.refunds });
  }
  if (permissions.includes('opd.reports.read')) {
    items.push({ href: '/app/opd/reports', label: nav.reports });
  }

  return (
    <>
      <OpdTabs items={items} />
      {children}
    </>
  );
}
