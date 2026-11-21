import { NextResponse } from 'next/server';
import { staffRoute } from '@/lib/auth/staff-route';
import {
  parseReportDate,
  parseReportQuery,
  queryParams,
  reportFileName,
  type ReportFileKind,
} from './reports';

const CONTENT_TYPE: Record<ReportFileKind, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * The shared body of the CSV and Excel download routes: the file of the API passed on byte for
 * byte. The date is checked here only to build a safe file name; the branch and the filters are
 * passed on only when they have a sensible shape; the API decides everything else, permission and
 * whether a value exists included. Errors are JSON, never a file.
 */
export async function reportDownload(
  request: Request,
  kind: ReportFileKind,
): Promise<NextResponse> {
  const url = new URL(request.url);
  const date = parseReportDate(url.searchParams.get('date') ?? undefined);
  if (!date) {
    return NextResponse.json(
      { code: 'REPORT_DATE_INVALID' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const query = parseReportQuery(Object.fromEntries(url.searchParams), date);
  return staffRoute({
    method: 'GET',
    path: `/opd/reports/daily-collection.${kind}`,
    query: Object.fromEntries(queryParams(query)),
    download: {
      contentType: CONTENT_TYPE[kind],
      fileName: reportFileName(date, query.branch, kind),
    },
  });
}
