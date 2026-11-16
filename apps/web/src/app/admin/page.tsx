import type { Metadata } from 'next';
import { HospitalsScreen } from '@/components/admin/hospitals-screen';
import { staffCopy } from '@/config/staff-copy';

export const metadata: Metadata = { title: staffCopy.pageTitles.admin };

export default function AdminPage() {
  return <HospitalsScreen />;
}
