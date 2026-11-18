import { CardsSkeleton, FormSkeleton, PageSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return (
    <PageSkeleton>
      <CardsSkeleton count={1} />
      <FormSkeleton fields={4} />
    </PageSkeleton>
  );
}
