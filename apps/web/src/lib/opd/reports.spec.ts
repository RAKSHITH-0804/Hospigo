import {
  ALL_BRANCHES,
  activeFilterCount,
  addDays,
  parseReportDate,
  parseReportQuery,
  queryParams,
  reportFileHref,
  reportFileName,
  reportHref,
  todayIn,
  type ReportQuery,
} from './reports';

describe('parseReportDate', () => {
  it('accepts only a real calendar day written YYYY-MM-DD', () => {
    expect(parseReportDate('2026-11-20')).toBe('2026-11-20');
    expect(parseReportDate('2024-02-29')).toBe('2024-02-29');
    for (const bad of [
      '2026-02-30',
      '2025-02-29',
      '2026-13-01',
      '2026-00-10',
      '20261120',
      '2026-1-5',
      '',
      ' 2026-11-20',
      '2026-11-20T00:00',
    ]) {
      expect({ bad, got: parseReportDate(bad) }).toEqual({ bad, got: null });
    }
    expect(parseReportDate(undefined)).toBeNull();
    expect(parseReportDate(['2026-11-20'])).toBeNull();
  });
});

describe('todayIn', () => {
  it('cuts the day in the given time zone, not in the server zone', () => {
    const instant = new Date('2026-11-19T20:00:00Z');
    expect(todayIn('UTC', instant)).toBe('2026-11-19');
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-11-20');
    expect(todayIn('Pacific/Kiritimati', instant)).toBe('2026-11-20');
    expect(todayIn('Pacific/Pago_Pago', instant)).toBe('2026-11-19');
  });

  it('is exactly at midnight India time (18:30 UTC)', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-11-19T18:29:59Z'))).toBe('2026-11-19');
    expect(todayIn('Asia/Kolkata', new Date('2026-11-19T18:30:00Z'))).toBe('2026-11-20');
  });
});

describe('addDays', () => {
  it('moves across month, year and leap days', () => {
    expect(addDays('2026-11-20', -1)).toBe('2026-11-19');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-20', 0)).toBe('2026-11-20');
  });
});

describe('parseReportQuery', () => {
  const fallback = '2026-11-20';

  it('with nothing in the address bar: today, the working branch, no filters', () => {
    expect(parseReportQuery({}, fallback)).toEqual({ date: fallback, branch: null, filters: {} });
  });

  it('reads the day, the branch and each of the five filters', () => {
    const q = parseReportQuery(
      {
        date: '2026-11-18',
        branch: ALL_BRANCHES,
        doctor: 'DR2',
        paymentMode: 'UPI',
        department: 'General Medicine',
        billType: 'INVESTIGATION',
        test: 'CBC',
      },
      fallback,
    );
    expect(q).toEqual({
      date: '2026-11-18',
      branch: 'ALL',
      filters: {
        doctor: 'DR2',
        paymentMode: 'UPI',
        department: 'General Medicine',
        billType: 'INVESTIGATION',
        test: 'CBC',
      },
    });
  });

  it('a date that is not a real day becomes the fallback', () => {
    for (const date of ['2026-02-30', 'x', '', undefined]) {
      expect(parseReportQuery({ date }, fallback).date).toBe(fallback);
    }
  });

  it('a branch that is neither ALL nor shaped like an id is dropped', () => {
    for (const branch of ['a b', '', '<x>', 'x'.repeat(65), '../etc']) {
      expect({ branch, got: parseReportQuery({ branch }, fallback).branch }).toEqual({
        branch,
        got: null,
      });
    }
    expect(parseReportQuery({ branch: 'ckabc123' }, fallback).branch).toBe('ckabc123');
  });

  it('a filter with an empty, too long or control-character value is dropped; the first of a list is used', () => {
    const q = parseReportQuery(
      {
        doctor: '   ',
        paymentMode: 'x'.repeat(101),
        department: 'bad\u0000value',
        test: ['CBC', 'XR'],
      },
      fallback,
    );
    expect(q.filters).toEqual({ test: 'CBC' });
  });
});

describe('links', () => {
  const base: ReportQuery = { date: '2026-11-20', branch: null, filters: {} };

  it('only what is set goes into the address and into the download links', () => {
    expect(reportHref(base)).toBe('/app/opd/reports?date=2026-11-20');
    const q: ReportQuery = {
      date: '2026-11-20',
      branch: 'ALL',
      filters: { doctor: 'DR2', department: 'General Medicine' },
    };
    expect(reportHref(q)).toBe(
      '/app/opd/reports?date=2026-11-20&branch=ALL&doctor=DR2&department=General+Medicine',
    );
    expect(reportFileHref('csv', q)).toBe(
      '/api/staff/opd/reports/daily-collection.csv?date=2026-11-20&branch=ALL&doctor=DR2&department=General+Medicine',
    );
    expect(reportFileHref('xlsx', base)).toBe(
      '/api/staff/opd/reports/daily-collection.xlsx?date=2026-11-20',
    );
  });

  it('a value is encoded, so it can never add a parameter of its own', () => {
    const q: ReportQuery = {
      date: '2026-11-20',
      branch: null,
      filters: { department: 'a&branch=ALL' },
    };
    const params = queryParams(q);
    expect(params.get('department')).toBe('a&branch=ALL');
    expect(params.get('branch')).toBeNull();
  });

  it('names the file after the day, and "all" only for all branches', () => {
    expect(reportFileName('2026-11-20', null, 'csv')).toBe('collection-2026-11-20.csv');
    expect(reportFileName('2026-11-20', 'ckabc', 'xlsx')).toBe('collection-2026-11-20.xlsx');
    expect(reportFileName('2026-11-20', 'ALL', 'xlsx')).toBe('collection-2026-11-20-all.xlsx');
  });

  it('counts the filters that are on (the branch is a place, not a filter)', () => {
    expect(activeFilterCount(base)).toBe(0);
    expect(
      activeFilterCount({ ...base, branch: 'ALL', filters: { doctor: 'DR1', test: 'CBC' } }),
    ).toBe(2);
  });
});
