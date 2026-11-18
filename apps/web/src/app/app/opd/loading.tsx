import { PageSkeleton, TableSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={6} />
    </PageSkeleton>
  );
}
