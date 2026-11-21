import ExcelJS from 'exceljs';
import type { CollectionRow, DailyCollectionReport, TestRow } from './daily-collection.service';
import { NO_DEPARTMENT_KEY } from './daily-collection.service';
import { paiseToRupees } from './csv.util';
import type { ReportSection } from './report-sections';

/** Names of the sheets (Excel allows at most 31 characters and no : \ / ? * [ ]). */
const SHEET_NAME: Record<ReportSection, string> = {
  MODE: 'By payment mode',
  DOCTOR: 'By doctor',
  DEPARTMENT: 'By department',
  BILL_TYPE: 'By bill type',
  TEST: 'Tests billed',
  BRANCH: 'By branch',
};

const NO_DEPARTMENT_LABEL = 'No department';
const BILL_TYPE_LABEL: Record<string, string> = {
  CONSULTATION: 'Consultation',
  INVESTIGATION: 'Tests',
};
const MONEY_FORMAT = '#,##0.00';

/**
 * Whole paise as a rupee NUMBER (an Excel cell that can be added up). Integer arithmetic through
 * the same text conversion the CSV uses, so a fractional amount is refused, never written.
 */
function rupees(paise: number): number {
  return Number(paiseToRupees(paise));
}

/**
 * A text cell. A string is always written as TEXT (never as a formula), so a doctor named
 * "=SUM(1+1)" shows exactly that and can never run.
 */
function text(value: string): ExcelJS.CellValue {
  return { richText: [{ text: value }] };
}

function boldHeader(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function moneyColumns(sheet: ExcelJS.Worksheet, columns: number[]): void {
  for (const index of columns) {
    sheet.getColumn(index).numFmt = MONEY_FORMAT;
    sheet.getColumn(index).alignment = { horizontal: 'right' };
  }
}

function addRowsSheet(
  book: ExcelJS.Workbook,
  title: string,
  rows: CollectionRow[],
  options: { visits: boolean; name: (row: CollectionRow) => string },
): void {
  const sheet = book.addWorksheet(title);
  const head = ['Name', 'Payments', 'Refunds', 'Collected', 'Refunded', 'Net'];
  if (options.visits) {
    head.splice(1, 0, 'Visits');
  }
  sheet.addRow(head);
  for (const r of rows) {
    const cells: ExcelJS.CellValue[] = [text(options.name(r))];
    if (options.visits) {
      cells.push(r.visits ?? 0);
    }
    cells.push(
      r.payments,
      r.refunds,
      rupees(r.collectedPaise),
      rupees(r.refundedPaise),
      rupees(r.netPaise),
    );
    sheet.addRow(cells);
  }
  boldHeader(sheet);
  sheet.getColumn(1).width = 30;
  const first = options.visits ? 5 : 4;
  moneyColumns(sheet, [first, first + 1, first + 2]);
}

function addTestsSheet(book: ExcelJS.Workbook, rows: TestRow[]): void {
  const sheet = book.addWorksheet(SHEET_NAME.TEST);
  sheet.addRow(['Test', 'Billed (count)', 'Billed amount']);
  for (const r of rows) {
    sheet.addRow([text(r.name), r.count, rupees(r.billedPaise)]);
  }
  boldHeader(sheet);
  sheet.getColumn(1).width = 36;
  moneyColumns(sheet, [3]);
}

/**
 * The collection report as an Excel workbook: a Summary sheet (day, branches, totals, ledger) and one
 * sheet for each chosen section. Amounts are numbers in rupees from whole paise. No patient data.
 */
export async function buildReportXlsx(
  report: DailyCollectionReport,
  sections: readonly ReportSection[],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'Hospigo';

  const summary = book.addWorksheet('Summary');
  summary.addRow(['Collection report']).font = { bold: true, size: 14 };
  summary.addRow([]);
  const info: Array<[string, ExcelJS.CellValue]> = [
    ['Date', text(report.date)],
    ['Branches', text(report.branches.map((b) => b.name).join(', '))],
    ['Time zone', text(report.timezone)],
    ['Visits', report.counts.visits],
    ['Visits cancelled', report.counts.visitsCancelled],
    ['Bills', report.counts.bills],
    ['Payments', report.totals.payments],
    ['Refunds', report.totals.refunds],
    ['Collected', rupees(report.totals.collectedPaise)],
    ['Refunded', rupees(report.totals.refundedPaise)],
    ['Net', rupees(report.totals.netPaise)],
    ['Matches the ledger', text(report.ledger.matches ? 'Yes' : 'No')],
  ];
  for (const [label, value] of info) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (['Collected', 'Refunded', 'Net'].includes(label)) {
      row.getCell(2).numFmt = MONEY_FORMAT;
    }
    row.getCell(2).alignment = { horizontal: 'left' };
  }
  summary.getColumn(1).width = 22;
  summary.getColumn(2).width = 36;

  for (const section of sections) {
    switch (section) {
      case 'MODE':
        addRowsSheet(book, SHEET_NAME.MODE, report.byMode, {
          visits: false,
          name: (r) => r.name,
        });
        break;
      case 'DOCTOR':
        addRowsSheet(book, SHEET_NAME.DOCTOR, report.byDoctor, {
          visits: true,
          name: (r) => r.name,
        });
        break;
      case 'DEPARTMENT':
        addRowsSheet(book, SHEET_NAME.DEPARTMENT, report.byDepartment, {
          visits: false,
          name: (r) => (r.key === NO_DEPARTMENT_KEY ? NO_DEPARTMENT_LABEL : r.name),
        });
        break;
      case 'BILL_TYPE':
        addRowsSheet(book, SHEET_NAME.BILL_TYPE, report.byBillType, {
          visits: false,
          name: (r) => BILL_TYPE_LABEL[r.key] ?? r.name,
        });
        break;
      case 'TEST':
        addTestsSheet(book, report.byTest);
        break;
      case 'BRANCH':
        if (report.combined) {
          addRowsSheet(book, SHEET_NAME.BRANCH, report.byBranch, {
            visits: true,
            name: (r) => r.name,
          });
        }
        break;
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
