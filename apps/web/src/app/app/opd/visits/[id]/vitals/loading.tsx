import { CardsSkeleton, PageSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return (
    <PageSkeleton>
      <CardsSkeleton count={3} />
    </PageSkeleton>
  );
}
