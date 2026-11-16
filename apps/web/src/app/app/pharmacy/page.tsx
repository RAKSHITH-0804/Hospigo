import { ComingLater } from '@/components/coming-later';
import { staffCopy } from '@/config/staff-copy';

export default function PharmacyPage() {
  return <ComingLater title={staffCopy.pageTitles.pharmacy} />;
}
