import { Activity, Building2, Users } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/states/empty-state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
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
      <div className="page-hero">
        <div className="flex flex-col gap-[var(--space-2)]">
          <h1>{copy.homeTitle}</h1>
          <p>{copy.countsHint}</p>
        </div>
        {overview.canManage ? (
          <Link
            href="/admin/onboard"
            className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}
          >
            {consoleCopy.navOnboard}
          </Link>
        ) : null}
      </div>
      <div className="kpi-grid">
        <div className="kpi-card tone-blue">
          <span className="icon-tile icon-tile-solid">
            <Building2 aria-hidden="true" />
          </span>
          <div className="kpi-text">
            <p className="kpi-label">{copy.kpiHospitals}</p>
            <p className="kpi-value">{overview.items.length}</p>
          </div>
        </div>
        {staffCount !== null ? (
          <div className="kpi-card tone-violet">
            <span className="icon-tile icon-tile-solid">
              <Users aria-hidden="true" />
            </span>
            <div className="kpi-text">
              <p className="kpi-label">{copy.kpiStaff}</p>
              <p className="kpi-value">{staffCount}</p>
            </div>
          </div>
        ) : null}
        {health ? (
          <div className={`kpi-card ${health.status === 'ok' ? 'tone-green' : 'tone-rose'}`}>
            <span className="icon-tile icon-tile-solid">
              <Activity aria-hidden="true" />
            </span>
            <div className="kpi-text">
              <p className="kpi-label">{copy.kpiHealth}</p>
              <p className="type-body font-bold text-foreground">
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
            </div>
          </div>
        ) : null}
      </div>
      {overview.items.length === 0 ? (
        <EmptyState
          title={staffCopy.admin.indigo.emptyTitle}
          description={staffCopy.admin.indigo.emptyHint}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
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
                    <td className="pr-[var(--space-3)]">
                      <Badge variant={hospital.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {hospital.status}
                      </Badge>
                    </td>
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
