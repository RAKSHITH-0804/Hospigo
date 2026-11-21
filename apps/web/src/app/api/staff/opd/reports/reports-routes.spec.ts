/**
 * @jest-environment node
 */

const ACCESS_COOKIE = `h.${Buffer.from(JSON.stringify({ branchId: 'branch-1' })).toString('base64url')}.s`;
const callStaffApiMock = jest.fn();
let hasAccessCookie = true;

jest.mock('@/lib/auth/staff-api', () => ({
  callStaffApi: (...args: unknown[]) => callStaffApiMock(...args),
}));

jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      hasAccessCookie && name === 'hospigo_access' ? { value: ACCESS_COOKIE } : undefined,
  }),
}));

import { GET as getCsv } from './daily-collection.csv/route';
import { GET as getXlsx } from './daily-collection.xlsx/route';

const URL_BASE = 'http://127.0.0.1:3001/api/staff/opd/reports/daily-collection.csv';
// The Excel mark (EF BB BF) must reach the browser untouched.
const CSV_BYTES = new Uint8Array([
  0xef,
  0xbb,
  0xbf,
  ...Buffer.from('date,branches,section\n2026-11-20,MAIN,TOTAL\n'),
]);

describe('GET /api/staff/opd/reports/daily-collection.csv', () => {
  beforeEach(() => {
    callStaffApiMock.mockReset();
    hasAccessCookie = true;
    callStaffApiMock.mockResolvedValue({ ok: true, data: CSV_BYTES.buffer.slice(0) });
  });

  it('passes the API file on byte for byte with a download file name', async () => {
    const res = await getCsv(new Request(`${URL_BASE}?date=2026-11-20`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="collection-2026-11-20.csv"',
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CSV_BYTES);
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/opd/reports/daily-collection.csv',
      expect.objectContaining({ method: 'GET', query: { date: '2026-11-20' }, raw: true }),
    );
  });

  it('asks for all branches only with branch=ALL and names the file for it', async () => {
    const res = await getCsv(new Request(`${URL_BASE}?date=2026-11-20&branch=ALL`));
    expect(res.headers.get('content-disposition')).toContain('collection-2026-11-20-all.csv');
    expect(callStaffApiMock.mock.calls[0]![1].query).toEqual({ date: '2026-11-20', branch: 'ALL' });
  });

  it('passes the branch and the filters on, as they are (the API says what exists)', async () => {
    await getCsv(
      new Request(
        `${URL_BASE}?date=2026-11-20&branch=ALL&doctor=DR2&paymentMode=UPI&department=General%20Medicine&billType=INVESTIGATION&test=CBC`,
      ),
    );
    expect(callStaffApiMock.mock.calls[0]![1].query).toEqual({
      date: '2026-11-20',
      branch: 'ALL',
      doctor: 'DR2',
      paymentMode: 'UPI',
      department: 'General Medicine',
      billType: 'INVESTIGATION',
      test: 'CBC',
    });
  });

  it('drops a branch or a filter with an odd shape before it reaches the API', async () => {
    const long = 'x'.repeat(101);
    await getCsv(
      new Request(
        `${URL_BASE}?date=2026-11-20&branch=a%20b&doctor=${long}&test=%00&sections=MODE&amount=1`,
      ),
    );
    expect(callStaffApiMock.mock.calls[0]![1].query).toEqual({ date: '2026-11-20' });
  });

  it('names the file for one branch without "all"', async () => {
    const res = await getCsv(new Request(`${URL_BASE}?date=2026-11-20&branch=ckabc123`));
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="collection-2026-11-20.csv"',
    );
    expect(callStaffApiMock.mock.calls[0]![1].query).toEqual({
      date: '2026-11-20',
      branch: 'ckabc123',
    });
  });

  it('refuses a bad or missing date without calling the API', async () => {
    for (const q of ['', '?date=2026-02-30', '?date=x', '?date="><script>', '?date=../../etc']) {
      const res = await getCsv(new Request(`${URL_BASE}${q}`));
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
      expect((await res.json()).code).toBe('REPORT_DATE_INVALID');
    }
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('answers JSON 401 without a session and never calls the API', async () => {
    hasAccessCookie = false;
    const res = await getCsv(new Request(`${URL_BASE}?date=2026-11-20`));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHORIZED');
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });

  it('shows the API refusal as JSON (403) and not as a file', async () => {
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: { code: 'FORBIDDEN' } });
    const res = await getCsv(new Request(`${URL_BASE}?date=2026-11-20`));
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect((await res.json()).code).toBe('FORBIDDEN');
  });
});

describe('GET /api/staff/opd/reports/daily-collection.xlsx', () => {
  const XLSX_URL = 'http://127.0.0.1:3001/api/staff/opd/reports/daily-collection.xlsx';
  // A zip starts with "PK": the bytes must reach the browser untouched.
  const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80]);

  beforeEach(() => {
    callStaffApiMock.mockReset();
    hasAccessCookie = true;
    callStaffApiMock.mockResolvedValue({ ok: true, data: XLSX_BYTES.buffer.slice(0) });
  });

  it('passes the API file on byte for byte with the Excel type and a download file name', async () => {
    const res = await getXlsx(new Request(`${XLSX_URL}?date=2026-11-20`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="collection-2026-11-20.xlsx"',
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(XLSX_BYTES);
    expect(callStaffApiMock).toHaveBeenCalledWith(
      '/opd/reports/daily-collection.xlsx',
      expect.objectContaining({ method: 'GET', query: { date: '2026-11-20' }, raw: true }),
    );
  });

  it('passes all branches and the filters on, and names the file for them', async () => {
    const res = await getXlsx(
      new Request(`${XLSX_URL}?date=2026-11-20&branch=ALL&doctor=DR2&test=CBC`),
    );
    expect(res.headers.get('content-disposition')).toContain('collection-2026-11-20-all.xlsx');
    expect(callStaffApiMock.mock.calls[0]![1].query).toEqual({
      date: '2026-11-20',
      branch: 'ALL',
      doctor: 'DR2',
      test: 'CBC',
    });
  });

  it('refuses a bad date, shows no file without a session, and shows an API refusal as JSON', async () => {
    const bad = await getXlsx(new Request(`${XLSX_URL}?date=2026-02-30`));
    expect(bad.status).toBe(400);
    expect(callStaffApiMock).not.toHaveBeenCalled();
    callStaffApiMock.mockResolvedValue({ ok: false, status: 403, body: { code: 'FORBIDDEN' } });
    const forbidden = await getXlsx(new Request(`${XLSX_URL}?date=2026-11-20`));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('content-disposition')).toBeNull();
    hasAccessCookie = false;
    callStaffApiMock.mockClear();
    expect((await getXlsx(new Request(`${XLSX_URL}?date=2026-11-20`))).status).toBe(401);
    expect(callStaffApiMock).not.toHaveBeenCalled();
  });
});
