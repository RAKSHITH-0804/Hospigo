import { reportDownload } from '@/lib/opd/report-download';

/**
 * GET /api/staff/opd/reports/daily-collection.csv?date=YYYY-MM-DD[&branch=ALL][&sections=...]:
 * the CSV of the day, passed on byte for byte (the API adds the Excel mark and the formula protection).
 */
export async function GET(request: Request) {
  return reportDownload(request, 'csv');
}
