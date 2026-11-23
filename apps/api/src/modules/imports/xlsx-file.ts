import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_LIMITS, type ImportTypeCode } from './import.config';

/** A file that cannot be used at all (the whole upload is refused, no batch is made). */
export class ImportFileError extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail?: string,
  ) {
    super(reason);
  }
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP64_MARK = 0xffffffff;

/**
 * Looks inside the zip BEFORE any spreadsheet library opens it. Refuses a file that is not a real
 * .xlsx (a renamed file, a text file, an old .xls), one with macros, external links or embedded
 * objects, an encrypted one, one with too many parts, and one that unpacks to more than allowed. A
 * zip can state small sizes and hold a huge one, so every part is really unpacked here, with a hard
 * limit, and its real size must equal the stated size.
 */
export function inspectXlsx(buf: Buffer): void {
  if (buf.length < 22 || buf.readUInt32LE(0) !== LOCAL_HEADER) {
    throw new ImportFileError('NOT_XLSX');
  }
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i -= 1) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new ImportFileError('NOT_XLSX');
  }
  const entries = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || dirOffset === ZIP64_MARK || dirSize === ZIP64_MARK) {
    throw new ImportFileError('NOT_XLSX');
  }
  if (entries === 0 || entries > IMPORT_LIMITS.maxZipEntries) {
    throw new ImportFileError(entries === 0 ? 'NOT_XLSX' : 'TOO_MANY_PARTS');
  }
  if (dirOffset + dirSize > buf.length) {
    throw new ImportFileError('NOT_XLSX');
  }

  const names = new Set<string>();
  let total = 0;
  let p = dirOffset;
  for (let n = 0; n < entries; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_HEADER) {
      throw new ImportFileError('NOT_XLSX');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const stated = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) {
      throw new ImportFileError('NOT_XLSX');
    }
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (flags & 1) {
      throw new ImportFileError('ENCRYPTED');
    }
    if (compressed === ZIP64_MARK || stated === ZIP64_MARK) {
      throw new ImportFileError('TOO_BIG_UNPACKED');
    }
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) {
      throw new ImportFileError('NOT_XLSX');
    }
    names.add(name);
    total += stated;
    if (total > IMPORT_LIMITS.maxUnzippedBytes) {
      throw new ImportFileError('TOO_BIG_UNPACKED');
    }
    // Really unpack the part (a folder entry has nothing to unpack).
    if (!name.endsWith('/')) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_HEADER) {
        throw new ImportFileError('NOT_XLSX');
      }
      const dataStart =
        localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      if (dataStart + compressed > buf.length) {
        throw new ImportFileError('NOT_XLSX');
      }
      const data = buf.subarray(dataStart, dataStart + compressed);
      let real: number;
      if (method === 0) {
        real = data.length;
      } else if (method === 8) {
        try {
          real = inflateRawSync(data, { maxOutputLength: stated + 1 }).length;
        } catch {
          throw new ImportFileError('TOO_BIG_UNPACKED');
        }
      } else {
        throw new ImportFileError('NOT_XLSX');
      }
      if (real !== stated) {
        throw new ImportFileError('TOO_BIG_UNPACKED');
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
    throw new ImportFileError('NOT_XLSX');
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes('vbaproject') || lower.startsWith('xl/macrosheets')) {
      throw new ImportFileError('MACROS');
    }
    if (lower.startsWith('xl/externallinks') || lower.startsWith('xl/embeddings')) {
      throw new ImportFileError('EXTERNAL_CONTENT');
    }
  }
}

/** One cell as read: plain values only. A real formula or an error cell is only marked. */
export type RawCell = string | number | boolean | Date | null | { formula: true } | { error: true };

export type ParsedSheet = {
  /** Column key (see IMPORT_COLUMNS) to the column number in the sheet. */
  columns: Record<string, number>;
  rows: Array<{ rowNumber: number; cells: Record<string, RawCell> }>;
};

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function cellValue(value: ExcelJS.CellValue): RawCell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      return { formula: true };
    }
    if ('error' in value) {
      return { error: true };
    }
    if ('richText' in value) {
      const text = value.richText
        .map((part) => part.text)
        .join('')
        .trim();
      return text === '' ? null : text;
    }
    if ('text' in value) {
      const text = String(value.text).trim();
      return text === '' ? null : text;
    }
  }
  return { error: true };
}

/**
 * Reads the first sheet. Row 1 holds the headings; the columns are found by their headings (in any
 * order, a few spellings accepted); the headings that are needed must all be there. Empty rows are
 * skipped. Text is kept as text: a cell that starts with = + - or @ is just those characters.
 */
export async function readSheet(buf: Buffer, type: ImportTypeCode): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('NOT_XLSX');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ImportFileError('NO_SHEET');
  }
  if (sheet.actualRowCount - 1 > IMPORT_LIMITS.maxRows) {
    throw new ImportFileError('TOO_MANY_ROWS');
  }
  if (sheet.actualColumnCount > IMPORT_LIMITS.maxColumns) {
    throw new ImportFileError('TOO_MANY_COLUMNS');
  }

  const defs = IMPORT_COLUMNS[type];
  const columns: Record<string, number> = {};
  const header = sheet.getRow(1);
  header.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = cell.value;
    const text =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'richText' in raw
          ? raw.richText.map((p) => p.text).join('')
          : '';
    const heading = normalizeHeader(text);
    const def = defs.find((d) => d.aliases.includes(heading));
    // The first column that matches a heading wins; a second one with the same meaning is ignored.
    if (def && columns[def.key] === undefined) {
      columns[def.key] = colNumber;
    }
  });
  const missing = defs.filter((d) => d.required && columns[d.key] === undefined);
  if (missing.length > 0) {
    throw new ImportFileError('MISSING_COLUMNS', missing.map((d) => d.header).join(', '));
  }

  const rows: ParsedSheet['rows'] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const cells: Record<string, RawCell> = {};
    let any = false;
    for (const def of defs) {
      const col = columns[def.key];
      const value = col === undefined ? null : cellValue(row.getCell(col).value);
      cells[def.key] = value;
      if (value !== null) {
        any = true;
      }
    }
    if (any) {
      rows.push({ rowNumber, cells });
    }
  });
  return { columns, rows };
}
