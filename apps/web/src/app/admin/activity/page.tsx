import type { Metadata } from 'next';
import { staffCopy } from '@/config/staff-copy';
import { formatDateTime } from '@/lib/format-datetime';
import type { HqActivityRow } from '@/lib/indigo/types';
import { fetchStaffOnServer } from '@/lib/patients/server';

const copy = staffCopy.admin.hq;

export const metadata: Metadata = { title: copy.activityTitle };

/** The HQ activity log: who in HQ changed what, in which hospital (HQ Admin only). */
export default async function ActivityPage() {
  const result = await fetchStaffOnServer<{ items: HqActivityRow[] }>('/indigo/activity');
  if (result.status !== 'ok') {
    return <p className="type-label">{staffCopy.admin.console.ownerOnly}</p>;
  }
  const rows = result.data.items;
  return (
    <div className="section-stack content-container-inner">
      <h1 className="type-heading font-medium">{copy.activityTitle}</h1>
      <p className="type-label text-muted-foreground">{copy.activityHint}</p>
      {rows.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.activityEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full type-small">
            <thead>
              <tr className="text-left">
                <th className="pr-[var(--space-3)]">{copy.activityWhen}</th>
                <th className="pr-[var(--space-3)]">{copy.activityWho}</th>
                <th className="pr-[var(--space-3)]">{copy.activityWhere}</th>
                <th>{copy.activityWhat}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="pr-[var(--space-3)]">{formatDateTime(row.at)}</td>
                  <td className="pr-[var(--space-3)]">{row.person ?? '-'}</td>
                  <td className="pr-[var(--space-3)]">{row.hospital ?? '-'}</td>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
