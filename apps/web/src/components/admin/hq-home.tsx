import Link from 'next/link';
import { EmptyState } from '@/components/states/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { staffCopy } from '@/config/staff-copy';
import { formatDateTime } from '@/lib/format-datetime';
import { fill } from '@/lib/opd/clinical-format';
import type { HqCounts, HqHealth, IndigoOverview } from '@/lib/indigo/types';
import { cn } from '@/lib/utils';

const copy = staffCopy.admin.hq;
const consoleCopy = staffCopy.admin.console;

/**
 * The HQ home (Phase 2.2): a few real numbers (hospitals, HQ Staff accounts, system health) and the
 * table of hospitals with counts. HQ never enters a hospital: the only link goes to the HQ page of
 * that hospital. A number the person may not see is simply not shown.
 */
export function HqHome({
  overview,
  counts,
  health,
  staffCount,
}: {
  overview: IndigoOverview;
  counts: HqCounts[] | null;
  health: HqHealth | null;
  staffCount: number | null;
}) {
  const byHospital = new Map((counts ?? []).map((c) => [c.hospitalId, c]));
  return (
    <div className="section-stack content-container-inner">
      <div className="cluster-between">
        <h1 className="type-heading font-medium">{copy.homeTitle}</h1>
        {overview.canManage ? (
          <Link href="/admin/onboard" className={cn(buttonVariants(), 'touch-target')}>
            {consoleCopy.navOnboard}
          </Link>
        ) : null}
      </div>
      <div className="stat-grid">
        <Card>
          <CardHeader>
            <CardTitle className="type-small">{copy.kpiHospitals}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="type-heading font-medium">{overview.items.length}</p>
          </CardContent>
        </Card>
        {staffCount !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="type-small">{copy.kpiStaff}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="type-heading font-medium">{staffCount}</p>
            </CardContent>
          </Card>
        ) : null}
        {health ? (
          <Card>
            <CardHeader>
              <CardTitle className="type-small">{copy.kpiHealth}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="type-label font-medium">
                {health.status === 'ok' ? copy.healthOk : copy.healthDegraded}
              </p>
              <p className="type-small text-muted-foreground">
                {fill(copy.healthLine, {
                  api: health.api,
                  database: health.database,
                  storage: health.storage,
                  migrations: health.migrations,
                })}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
      <p className="type-small text-muted-foreground">{copy.countsHint}</p>
      {overview.items.length === 0 ? (
        <EmptyState
          title={staffCopy.admin.indigo.emptyTitle}
          description={staffCopy.admin.indigo.emptyHint}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full type-small">
            <thead>
              <tr className="text-left">
                <th className="py-[var(--space-1)] pr-[var(--space-3)]">{copy.colName}</th>
                <th className="pr-[var(--space-3)]">{copy.colCode}</th>
                <th className="pr-[var(--space-3)]">{copy.colModules}</th>
                <th className="pr-[var(--space-3)]">{copy.colStatus}</th>
                {counts ? <th className="pr-[var(--space-3)]">{copy.colVisitsToday}</th> : null}
                {counts ? <th className="pr-[var(--space-3)]">{copy.colLastActivity}</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {overview.items.map((hospital) => {
                const c = byHospital.get(hospital.id);
                return (
                  <tr key={hospital.id}>
                    <td className="py-[var(--space-1)] pr-[var(--space-3)] font-medium">
                      {hospital.name}
                    </td>
                    <td className="pr-[var(--space-3)]">{hospital.code}</td>
                    <td className="pr-[var(--space-3)]">{hospital.modules.join(', ')}</td>
                    <td className="pr-[var(--space-3)]">{hospital.status}</td>
                    {counts ? (
                      <td className="pr-[var(--space-3)]">{c ? c.visitsToday : '-'}</td>
                    ) : null}
                    {counts ? (
                      <td className="pr-[var(--space-3)]">
                        {c?.lastActivity ? formatDateTime(c.lastActivity) : copy.noActivity}
                      </td>
                    ) : null}
                    <td>
                      <Link href={`/admin/hospitals/${hospital.id}`} className="underline">
                        {copy.open}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
