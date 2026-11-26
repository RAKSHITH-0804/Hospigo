import Link from 'next/link';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { formatDateTime } from '@/lib/format-datetime';
import type { AccessLogResponse } from '@/lib/indigo/library';

const copy = staffCopy.indigoLog;

/** Who from Indigo entered this hospital, newest first (read-only; the SuperAdmin only). */
export function IndigoAccessScreen({
  data,
  page,
}: {
  data: AccessLogResponse | null;
  page: number;
}) {
  if (!data) {
    return (
      <p role="alert" className="type-label text-destructive">
        {copy.loadFailed}
      </p>
    );
  }
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="section-stack">
      <h1 className="type-heading font-medium">{copy.title}</h1>
      <p className="type-label text-muted-foreground">{copy.hint}</p>
      {data.items.length === 0 ? (
        <EmptyState title={copy.title} description={copy.empty} />
      ) : (
        <table className="data-table type-small">
          <thead>
            <tr>
              <th scope="col">{copy.when}</th>
              <th scope="col">{copy.person}</th>
              <th scope="col">{copy.action}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.at)}</td>
                <td>{row.person ?? '—'}</td>
                <td>{copy.actions[row.action] ?? row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="cluster-between type-small">
        <span>{fill(copy.page, { page, pages })}</span>
        <span className="flex gap-[var(--space-3)]">
          {page > 1 ? (
            <Link href={`/app/settings/indigo-access?page=${page - 1}`}>{copy.previous}</Link>
          ) : null}
          {page < pages ? (
            <Link href={`/app/settings/indigo-access?page=${page + 1}`}>{copy.next}</Link>
          ) : null}
        </span>
      </div>
    </div>
  );
}
