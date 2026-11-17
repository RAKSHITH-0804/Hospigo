import { CardsSkeleton, PageSkeleton, SkeletonBlock } from '@/components/states/skeletons';

/** Covers /app/settings and every /app/settings/[section] (same frame as the real page). */
export default function Loading() {
  return (
    <PageSkeleton>
      <div className="settings-layout">
        <div className="settings-nav">
          <SkeletonBlock className="skeleton-control" />
        </div>
        <div className="settings-content">
          <CardsSkeleton count={1} />
        </div>
      </div>
    </PageSkeleton>
  );
}
