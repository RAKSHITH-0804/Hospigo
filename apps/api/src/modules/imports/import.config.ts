/** Step 8b, part C: Excel upload of the masters. No UI text here (the web has its own copy file). */

export const IMPORT_TYPE_CODES = ['TESTS', 'DOCTOR_FEES', 'MEDICINES'] as const;
export type ImportTypeCode = (typeof IMPORT_TYPE_CODES)[number];

/** Names kept in the catalog (import_types); the screen shows its own words. */
export const IMPORT_TYPE_NAMES: Record<ImportTypeCode, string> = {
  TESTS: 'Tests and prices',
  DOCTOR_FEES: 'Doctor fees',
  MEDICINES: 'Medicines',
};

/** Permission that changes prices: needed on top of opd.masters.write for these types. */
export const IMPORT_PRICE_TYPES: readonly ImportTypeCode[] = ['TESTS', 'DOCTOR_FEES'];

export const IMPORT_TEMPLATE_VERSION = 'v1';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const IMPORT_LIMITS = {
  /** The file, as sent (compressed). */
  maxBytes: 2 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 30,
  /** What the file may unpack to (a zip can claim far more than it holds). */
  maxUnzippedBytes: 25 * 1024 * 1024,
  maxZipEntries: 100,
  codeMax: 40,
  nameMax: 150,
  compositionMax: 300,
  formMax: 60,
  /** Longest text of any cell that is read at all. */
  cellMax: 400,
  codePattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  listDefaultPageSize: 25,
  listMaxPageSize: 100,
  rowsDefaultPageSize: 50,
  /** A batch stuck in a background run for longer than this may be run again. */
  staleRunMs: 10 * 60 * 1000,
  /** The longest a read or a save of a whole file may take (the usual limit is a few seconds). */
  transactionMs: 120_000,
  idPattern: /^[A-Za-z0-9_-]{1,64}$/,
} as const;

export type ColumnDef = {
  key: string;
  /** The words in the first row of the template. */
  header: string;
  /** Other spellings of the heading that are accepted (lower case, letters and digits only). */
  aliases: readonly string[];
  required: boolean;
  /** A value for the sample row of the template. */
  example: string | number;
};

export const IMPORT_COLUMNS: Record<ImportTypeCode, readonly ColumnDef[]> = {
  TESTS: [
    { key: 'code', header: 'Code', aliases: ['code', 'testcode'], required: true, example: 'CBC' },
    {
      key: 'name',
      header: 'Name',
      aliases: ['name', 'testname'],
      required: true,
      example: 'Complete blood count',
    },
    {
      key: 'price',
      header: 'Price',
      aliases: ['price', 'pricerupees', 'amount', 'rate'],
      required: true,
      example: 350,
    },
    {
      key: 'startDate',
      header: 'Start date',
      aliases: ['startdate', 'effectivedate', 'effectivefrom', 'date'],
      required: false,
      example: '',
    },
    {
      key: 'active',
      header: 'Active',
      aliases: ['active', 'status'],
      required: false,
      example: 'Yes',
    },
  ],
  DOCTOR_FEES: [
    {
      key: 'doctorCode',
      header: 'Doctor code',
      aliases: ['doctorcode', 'doctor', 'code'],
      required: true,
      example: 'DR001',
    },
    {
      key: 'visitType',
      header: 'Visit type',
      aliases: ['visittype', 'type', 'visit'],
      required: true,
      example: 'NEW',
    },
    {
      key: 'amount',
      header: 'Fee',
      aliases: ['fee', 'amount', 'price', 'feerupees'],
      required: true,
      example: 500,
    },
    {
      key: 'startDate',
      header: 'Start date',
      aliases: ['startdate', 'effectivedate', 'effectivefrom', 'date'],
      required: false,
      example: '',
    },
    {
      // Step 9: blank = the doctor's hospital-wide fee; a branch code = the fee in that branch only.
      key: 'branchCode',
      header: 'Branch code',
      aliases: ['branchcode', 'branch'],
      required: false,
      example: '',
    },
  ],
  MEDICINES: [
    {
      key: 'code',
      header: 'Code',
      aliases: ['code', 'medicinecode'],
      required: true,
      example: 'PCM500',
    },
    {
      key: 'name',
      header: 'Name',
      aliases: ['name', 'medicinename'],
      required: true,
      example: 'Paracetamol 500 mg',
    },
    {
      key: 'composition',
      header: 'Composition',
      aliases: ['composition', 'generic', 'salt'],
      required: false,
      example: 'Paracetamol',
    },
    {
      key: 'form',
      header: 'Form',
      aliases: ['form', 'dosageform'],
      required: false,
      example: 'Tablet',
    },
    {
      key: 'active',
      header: 'Active',
      aliases: ['active', 'status'],
      required: false,
      example: 'Yes',
    },
  ],
};

/** A second sample row, so the template shows both visit types of a doctor. */
export const IMPORT_SAMPLE_ROWS: Record<
  ImportTypeCode,
  ReadonlyArray<Record<string, string | number>>
> = {
  TESTS: [{ code: 'CBC', name: 'Complete blood count', price: 350, startDate: '', active: 'Yes' }],
  DOCTOR_FEES: [
    { doctorCode: 'DR001', visitType: 'NEW', amount: 500, startDate: '', branchCode: '' },
    { doctorCode: 'DR001', visitType: 'FOLLOW_UP', amount: 300, startDate: '', branchCode: '' },
  ],
  MEDICINES: [
    {
      code: 'PCM500',
      name: 'Paracetamol 500 mg',
      composition: 'Paracetamol',
      form: 'Tablet',
      active: 'Yes',
    },
  ],
};

export function isImportType(value: string): value is ImportTypeCode {
  return (IMPORT_TYPE_CODES as readonly string[]).includes(value);
}

/** Audit action of a posted batch (counts only). */
export const IMPORT_AUDIT = { applied: 'IMPORT_BATCH_APPLY' } as const;
