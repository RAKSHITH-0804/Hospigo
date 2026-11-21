import ExcelJS from 'exceljs';
import type { CollectionRow, DailyCollectionReport } from './daily-collection.service';
import { buildReportXlsx } from './report-xlsx';
import { REPORT_SECTIONS } from './report-sections';

function row(
  key: string,
  name: string,
  collected: number,
  refunded: number,
  visits?: number,
): CollectionRow {
  return {
    key,
    name,
    payments: collected > 0 ? 1 : 0,
    refunds: refunded > 0 ? 1 : 0,
    collectedPaise: collected,
    refundedPaise: refunded,
    netPaise: collected - refunded,
    ...(visits === undefined ? {} : { visits }),
  };
}

function makeReport(overrides: Partial<DailyCollectionReport> = {}): DailyCollectionReport {
  return {
    date: '2026-11-20',
    timezone: 'Asia/Kolkata',
    branches: [{ id: 'b1', code: 'MAIN', name: 'Main Branch' }],
    combined: false,
    totals: {
      payments: 3,
      refunds: 1,
      collectedPaise: 150_005,
      refundedPaise: 50_000,
      netPaise: 100_005,
    },
    counts: { visits: 4, visitsCancelled: 1, bills: 5 },
    byMode: [row('CASH', 'Cash', 100_005, 50_000), row('UPI', 'UPI', 50_000, 0)],
    byDoctor: [row('DR1', '=SUM(1+1)', 150_005, 50_000, 4)],
    byDepartment: [row('General', 'General', 100_005, 0), row('(none)', '(none)', 50_000, 50_000)],
    byBillType: [
      row('CONSULTATION', 'CONSULTATION', 100_005, 0),
      row('INVESTIGATION', 'INVESTIGATION', 50_000, 50_000),
    ],
    byTest: [
      { key: 'CBC', name: '@cmd|calc', count: 2, billedPaise: 30_000 },
      { key: 'XR', name: 'Chest X-ray', count: 1, billedPaise: 20_000 },
    ],
    byBranch: [row('MAIN', 'Main Branch', 150_005, 50_000, 4)],
    ledger: { paymentPaise: 150_005, refundPaise: 50_000, matches: true },
    ...overrides,
  };
}

async function open(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return book;
}

describe('buildReportXlsx', () => {
  it('is a real workbook with a Summary sheet and one sheet per chosen section', async () => {
    const book = await open(await buildReportXlsx(makeReport(), ['MODE', 'TEST']));
    expect(book.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'By payment mode',
      'Tests billed',
    ]);
  });

  it('writes every section in the report order when all are chosen (the branch sheet only for a combined report)', async () => {
    const single = await open(await buildReportXlsx(makeReport(), REPORT_SECTIONS));
    expect(single.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'By payment mode',
      'By doctor',
      'By department',
      'By bill type',
      'Tests billed',
    ]);
    const combined = await open(
      await buildReportXlsx(makeReport({ combined: true }), REPORT_SECTIONS),
    );
    expect(combined.worksheets.map((s) => s.name)).toContain('By branch');
  });

  it('writes amounts as numbers in rupees from whole paise, so they can be added up', async () => {
    const book = await open(await buildReportXlsx(makeReport(), ['MODE']));
    const summary = book.getWorksheet('Summary')!;
    const valueOf = (label: string) => {
      let found: ExcelJS.CellValue = null;
      summary.eachRow((r) => {
        if (r.getCell(1).text === label) found = r.getCell(2).value;
      });
      return found;
    };
    expect(valueOf('Collected')).toBe(1500.05);
    expect(valueOf('Refunded')).toBe(500);
    expect(valueOf('Net')).toBe(1000.05);
    expect(valueOf('Visits')).toBe(4);
    const modes = book.getWorksheet('By payment mode')!;
    expect(modes.getRow(2).getCell(1).text).toBe('Cash');
    expect(modes.getRow(2).getCell(4).value).toBe(1000.05);
    expect(typeof modes.getRow(2).getCell(4).value).toBe('number');
    expect(modes.getColumn(4).numFmt).toBe('#,##0.00');
  });

  it('says whether the books match', async () => {
    const yes = await open(await buildReportXlsx(makeReport(), []));
    const no = await open(
      await buildReportXlsx(
        makeReport({ ledger: { paymentPaise: 1, refundPaise: 0, matches: false } }),
        [],
      ),
    );
    const find = (book: ExcelJS.Workbook) => {
      let out = '';
      book.getWorksheet('Summary')!.eachRow((r) => {
        if (r.getCell(1).text === 'Matches the ledger') out = r.getCell(2).text;
      });
      return out;
    };
    expect(find(yes)).toBe('Yes');
    expect(find(no)).toBe('No');
  });

  it('a name that looks like a formula stays plain text and can never run', async () => {
    const book = await open(await buildReportXlsx(makeReport(), ['DOCTOR', 'TEST']));
    const doctor = book.getWorksheet('By doctor')!.getRow(2).getCell(1);
    expect(doctor.text).toBe('=SUM(1+1)');
    expect(doctor.formula).toBeUndefined();
    expect(doctor.type).not.toBe(ExcelJS.ValueType.Formula);
    const test = book.getWorksheet('Tests billed')!.getRow(2).getCell(1);
    expect(test.text).toBe('@cmd|calc');
    expect(test.formula).toBeUndefined();
  });

  it('names a doctor without a department and gives bill types readable names', async () => {
    const book = await open(await buildReportXlsx(makeReport(), ['DEPARTMENT', 'BILL_TYPE']));
    const departments = book.getWorksheet('By department')!;
    expect([2, 3].map((r) => departments.getRow(r).getCell(1).text)).toEqual([
      'General',
      'No department',
    ]);
    const types = book.getWorksheet('By bill type')!;
    expect([2, 3].map((r) => types.getRow(r).getCell(1).text)).toEqual(['Consultation', 'Tests']);
  });

  it('tests billed has its own columns: count and billed amount', async () => {
    const book = await open(await buildReportXlsx(makeReport(), ['TEST']));
    const sheet = book.getWorksheet('Tests billed')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Test', 'Billed (count)', 'Billed amount']);
    expect(sheet.getRow(3).getCell(2).value).toBe(1);
    expect(sheet.getRow(3).getCell(3).value).toBe(200);
  });

  it('puts visits only on the doctor and branch sheets', async () => {
    const book = await open(
      await buildReportXlsx(makeReport({ combined: true }), ['MODE', 'DOCTOR', 'BRANCH']),
    );
    expect(book.getWorksheet('By payment mode')!.getRow(1).getCell(2).text).toBe('Payments');
    expect(book.getWorksheet('By doctor')!.getRow(1).getCell(2).text).toBe('Visits');
    expect(book.getWorksheet('By branch')!.getRow(1).getCell(2).text).toBe('Visits');
  });

  it('refuses an amount that is not whole paise instead of writing it', async () => {
    const bad = makeReport({
      totals: { payments: 1, refunds: 0, collectedPaise: 10.5, refundedPaise: 0, netPaise: 10.5 },
    });
    await expect(buildReportXlsx(bad, [])).rejects.toThrow(/whole number of paise/);
  });
});
