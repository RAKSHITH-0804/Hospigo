import type { Metadata } from 'next';
import { HqHome } from '@/components/admin/hq-home';
import { staffCopy } from '@/config/staff-copy';
import type { HqCounts, HqHealth, IndigoEmployee, IndigoOverview } from '@/lib/indigo/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.pageTitles.admin };

/** The HQ home: real counts and the hospitals HQ may see. HQ never enters a hospital. */
export default async function AdminPage() {
  const [overview, counts, health, employees] = await Promise.all([
    fetchStaffOnServer<IndigoOverview>('/indigo/hospitals'),
    fetchStaffOnServer<{ items: HqCounts[] }>('/indigo/monitoring'),
    fetchStaffOnServer<HqHealth>('/indigo/health'),
    fetchStaffOnServer<{ items: IndigoEmployee[] }>('/indigo/employees'),
  ]);
  if (overview.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(overview))}
      </p>
    );
  }
  return (
    <HqHome
      overview={overview.data}
      counts={counts.status === 'ok' ? counts.data.items : null}
      health={health.status === 'ok' ? health.data : null}
      staffCount={employees.status === 'ok' ? employees.data.items.length : null}
    />
  );
}
