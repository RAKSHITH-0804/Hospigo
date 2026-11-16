import { ComingLater } from '@/components/coming-later';
import { staffCopy } from '@/config/staff-copy';

export default function IpdPage() {
  return <ComingLater title={staffCopy.pageTitles.ipd} />;
}
