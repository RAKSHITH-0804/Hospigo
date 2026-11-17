import type { Metadata } from 'next';
import Link from 'next/link';
import { PatientsSearch } from '@/components/patients/patients-search';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { patientsWebConfig } from '@/config/patients';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { isSearchable, parseListParams } from '@/lib/patients/list-params';
import { API_PATIENTS, fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import type { PatientListResponse } from '@/lib/patients/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: staffCopy.pageTitles.patients };

type SearchParams = Promise<{
  q?: string | string[];
  sort?: string | string[];
  col?: string | string[];
  page?: string | string[];
}>;

export default async function PatientsPage({ searchParams }: { searchParams?: SearchParams }) {
  const session = await requirePermission('patients.registry.read');
  const canWrite = session.permissions?.includes('patients.registry.write') ?? false;
  const params = parseListParams((searchParams ? await searchParams : undefined) ?? {});

  // Text shorter than the minimum is not sent: the page shows the plain list plus the hint.
  const searchable = !params.q || isSearchable(params.q, patientsWebConfig.searchMinLength);
  const applied = searchable ? params : { ...params, q: '' };

  // First-paint data is fetched on the server (one API call) and passed as props.
  const listQuery = (q: string) => ({
    sort: applied.sort,
    page: applied.page,
    pageSize: patientsWebConfig.searchPageSize,
    q: q || undefined,
  });
  let first = await fetchStaffOnServer<PatientListResponse>(API_PATIENTS, listQuery(applied.q));
  // The API is the authority on the minimum: if it refuses the text, show the plain list + hint.
  const apiRefusedText =
    first.status === 'invalid' && Boolean(first.fieldErrors?.q) && Boolean(applied.q);
  if (apiRefusedText) {
    first = await fetchStaffOnServer<PatientListResponse>(API_PATIENTS, listQuery(''));
  }
  const hint = !searchable || apiRefusedText;
  const shownParams = apiRefusedText ? { ...applied, q: '' } : applied;

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <PageHeader
        title={staffCopy.patients.title}
        description={staffCopy.patients.description}
        actions={
          canWrite ? (
            <Link href="/app/patients/new" className={cn(buttonVariants(), 'touch-target')}>
              {staffCopy.patients.registerAction}
            </Link>
          ) : undefined
        }
      />
      <PatientsSearch
        // A new server render (link click) remounts the client state from the new URL.
        key={`${params.q}|${params.sort}|${params.col}|${params.page}`}
        canWrite={canWrite}
        initial={{
          params: shownParams,
          draft: params.q,
          result: first.status === 'ok' ? first.data : null,
          errorCode: first.status === 'ok' ? null : serverErrorCode(first),
          hint,
        }}
        minLength={patientsWebConfig.searchMinLength}
        maxLength={patientsWebConfig.searchMaxLength}
        debounceMs={patientsWebConfig.searchDebounceMs}
        pageSize={patientsWebConfig.searchPageSize}
        dateLocale={patientsWebConfig.dateLocale}
      />
    </div>
  );
}
