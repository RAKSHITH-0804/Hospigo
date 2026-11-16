import type { Metadata } from 'next';
import { ComingLater } from '@/components/coming-later';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.adminHealth };

export default function AdminHealthPage() {
  return <ComingLater title={staffCopy.pageTitles.adminHealth} />;
}
