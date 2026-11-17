import { FormSkeleton, PageSkeleton } from '@/components/states/skeletons';

export default function Loading() {
  return (
    <PageSkeleton>
      <FormSkeleton />
    </PageSkeleton>
  );
}
