import type { Metadata } from 'next';
import { ComingLater } from '@/components/coming-later';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.adminStaff };

export default function AdminStaffPage() {
  return <ComingLater title={staffCopy.pageTitles.adminStaff} />;
}
