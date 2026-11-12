import { ComingLater } from '@/components/coming-later';
import { sessionConfig } from '@/config/session';

export default async function StaffDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const unavailable = params?.notice === 'module-unavailable';

  return (
    <div className="stack gap-[var(--space-3)]">
      {unavailable ? (
        <p role="status" className="type-label text-destructive">
          {sessionConfig.errorModuleUnavailable}
        </p>
      ) : null}
      <ComingLater title="Dashboard" />
    </div>
  );
}
