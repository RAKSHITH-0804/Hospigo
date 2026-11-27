import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HqHospital } from '@/components/admin/hq-hospital';
import { staffCopy } from '@/config/staff-copy';
import type { LibraryOverview } from '@/lib/indigo/library';
import type { HqActivePrint, HqCounts, HqSuperAdmin, IndigoOverview } from '@/lib/indigo/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.admin.hq.homeTitle };

/** One hospital for HQ: counts, branches, modules, print design and logo, Super Admin. No entry. */
export default async function HospitalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const overview = await fetchStaffOnServer<IndigoOverview>('/indigo/hospitals');
  if (overview.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(overview))}
      </p>
    );
  }
  const hospital = overview.data.items.find((h) => h.id === id);
  if (!hospital) {
    notFound();
  }
  const enc = encodeURIComponent(id);
  const [counts, library, active, admins] = await Promise.all([
    fetchStaffOnServer<{ items: HqCounts[] }>('/indigo/monitoring'),
    fetchStaffOnServer<LibraryOverview>('/indigo/library'),
    fetchStaffOnServer<HqActivePrint>(`/indigo/hospitals/${enc}/print`),
    fetchStaffOnServer<{ items: HqSuperAdmin[] }>(`/indigo/hospitals/${enc}/super-admins`),
  ]);
  return (
    <HqHospital
      hospital={hospital}
      overview={overview.data}
      counts={
        counts.status === 'ok' ? (counts.data.items.find((c) => c.hospitalId === id) ?? null) : null
      }
      library={library.status === 'ok' ? library.data : null}
      active={active.status === 'ok' ? active.data : null}
      superAdmins={admins.status === 'ok' ? admins.data.items : null}
    />
  );
}
