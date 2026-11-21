import { reportDownload } from '@/lib/opd/report-download';

/**
 * GET /api/staff/opd/reports/daily-collection.xlsx?date=YYYY-MM-DD[&branch=ALL][&sections=...]:
 * the Excel workbook of the day, passed on byte for byte.
 */
export async function GET(request: Request) {
  return reportDownload(request, 'xlsx');
}
