import type { Metadata } from 'next';
import Link from 'next/link';
import { CollectionReport } from '@/components/opd/collection-report';
import { buttonVariants } from '@/components/ui/button';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { parseReportQuery, queryParams, reportHref, todayIn } from '@/lib/opd/reports';
import type { DailyCollectionReport, ReportFilterOptions } from '@/lib/opd/reports-types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import { cn } from '@/lib/utils';

const copy = staffCopy.opd.reports;

export const metadata: Metadata = { title: staffCopy.pageTitles.opdReports };

const API_REPORT = '/opd/reports/daily-collection';
const API_FILTERS = '/opd/reports/filters';

/**
 * Daily collection report for Admins (opd.reports.read). The day, the branch and the filters come
 * from the address bar; the lists of the dropdowns come from the API. The API decides what may be
 * seen (a branch the person may not report on is refused there) and what is a real value.
 */
export default async function CollectionReportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('opd.reports.read');
  const today = todayIn(opdWebConfig.reportTimeZone);
  const query = parseReportQuery((await searchParams) ?? {}, today);

  const [options, result] = await Promise.all([
    fetchStaffOnServer<ReportFilterOptions>(API_FILTERS),
    fetchStaffOnServer<DailyCollectionReport>(API_REPORT, Object.fromEntries(queryParams(query))),
  ]);

  if (options.status !== 'ok' || result.status !== 'ok') {
    const failed = options.status !== 'ok' ? options : result;
    const message =
      failed.status === 'invalid'
        ? copy.invalidQuery
        : failed.status === 'forbidden' && query.branch
          ? copy.scopeForbidden
          : errorMessageFor(serverErrorCode(failed as Parameters<typeof serverErrorCode>[0]));
    return (
      <div className="section-stack content-container-inner">
        <p className="type-label-strong">{copy.loadErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {message}
        </p>
        <Link
          href={reportHref({ date: today, branch: null, filters: {} })}
          className={cn(buttonVariants({ variant: 'outline' }), 'touch-target w-fit')}
        >
          {copy.backToBranch}
        </Link>
      </div>
    );
  }

  return (
    <CollectionReport
      report={result.data}
      options={options.data}
      query={query}
      today={today}
      weekStart={opdWebConfig.calendarWeekStart}
    />
  );
}
