import type { Metadata } from 'next';
import { ComingLater } from '@/components/coming-later';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.adminImports };

export default function AdminImportsPage() {
  return <ComingLater title={staffCopy.pageTitles.adminImports} />;
}
