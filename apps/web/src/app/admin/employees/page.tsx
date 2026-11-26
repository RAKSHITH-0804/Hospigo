import type { Metadata } from 'next';
import { IndigoEmployees } from '@/components/admin/indigo-employees';
import { staffCopy } from '@/config/staff-copy';
import type { IndigoEmployee, IndigoOverview } from '@/lib/indigo/types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

export const metadata: Metadata = { title: staffCopy.admin.console.employeesTitle };

export default async function EmployeesPage() {
  const [overview, employees] = await Promise.all([
    fetchStaffOnServer<IndigoOverview>('/indigo/hospitals'),
    fetchStaffOnServer<{ items: IndigoEmployee[] }>('/indigo/employees'),
  ]);
  if (overview.status !== 'ok') {
    return (
      <p role="alert" className="type-label text-destructive">
        {errorMessageFor(serverErrorCode(overview))}
      </p>
    );
  }
  if (!overview.data.canManage || employees.status !== 'ok') {
    return <p className="type-label">{staffCopy.admin.console.ownerOnly}</p>;
  }
  return (
    <IndigoEmployees
      employees={employees.data.items}
      hospitals={overview.data.items.map((h) => ({ id: h.id, name: h.name }))}
    />
  );
}
