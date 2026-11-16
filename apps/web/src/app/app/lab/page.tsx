import { ComingLater } from '@/components/coming-later';
import { staffCopy } from '@/config/staff-copy';

export default function LabPage() {
  return <ComingLater title={staffCopy.pageTitles.lab} />;
}
