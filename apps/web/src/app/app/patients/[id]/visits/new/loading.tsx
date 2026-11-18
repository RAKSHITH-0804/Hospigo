import { CardsSkeleton, PageSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return (
    <PageSkeleton>
      <CardsSkeleton count={2} />
    </PageSkeleton>
  );
}
