/** ENG-123a — Browser-only CSV/XLSX reader for the launch import workbench. */

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_COLUMNS = 50;

export type ImportFileErrorCode =
  | 'unsupported_file'
  | 'file_too_large'
  | 'empty_file'
  | 'empty_header'
  | 'duplicate_header'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'row_too_wide'
  | 'malformed_csv'
  | 'workbook_empty';

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(code);
    this.name = 'ImportFileError';
  }
}

export interface ParsedImportRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedImportFile {
  sourceName: string;
  headers: string[];
  rows: ParsedImportRow[];
}

function validateHeaders(rawHeaders: string[]): string[] {
  if (rawHeaders.length === 0 || rawHeaders.every(header => header.trim().length === 0)) {
    throw new ImportFileError('empty_header');
  }
  if (rawHeaders.length > MAX_IMPORT_COLUMNS) throw new ImportFileError('too_many_columns');

  const headers = rawHeaders.map(header => header.trim());
  if (headers.some(header => header.length === 0)) throw new ImportFileError('empty_header');
  const keys = headers.map(header =>
    header
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en-US')
  );
  if (new Set(keys).size !== keys.length) throw new ImportFileError('duplicate_header');
  return headers;
}

function buildRows(
  sourceName: string,
  matrix: string[][],
  sourceRowNumbers?: number[]
): ParsedImportFile {
  if (matrix.length === 0) throw new ImportFileError('empty_file');
  const headers = validateHeaders(matrix[0] ?? []);
  const rows = matrix
    .slice(1)
    .map((cells, index) => ({
      cells,
      rowNumber: sourceRowNumbers?.[index + 1] ?? index + 2,
    }))
    .filter(({ cells }) => cells.some(cell => cell.trim().length > 0))
    .map(({ cells, rowNumber }) => {
      if (cells.slice(headers.length).some(cell => cell.trim().length > 0)) {
        throw new ImportFileError('row_too_wide');
      }
      return {
        rowNumber,
        values: Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])),
      };
    });
  if (rows.length === 0) throw new ImportFileError('empty_file');
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportFileError('too_many_rows');
  return { sourceName, headers, rows };
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const candidates = [',', ';', '\t'] as const;
  const counts = new Map<(typeof candidates)[number], number>(candidates.map(value => [value, 0]));
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) break;
    if (!quoted && candidates.includes(char as (typeof candidates)[number])) {
      const candidate = char as (typeof candidates)[number];
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }
  return candidates.reduce((best, candidate) =>
    (counts.get(candidate) ?? 0) > (counts.get(best) ?? 0) ? candidate : best
  );
}

export function parseCsvText(text: string, sourceName = 'import.csv'): ParsedImportFile {
  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) throw new ImportFileError('empty_file');
  const delimiter = detectDelimiter(clean);
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]!;
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        cell += char;
      }
      continue;
    }
    if (closedQuote && char !== delimiter && char !== '\n' && char !== '\r') {
      throw new ImportFileError('malformed_csv');
    }
    if (char === '"') {
      if (cell.length > 0) throw new ImportFileError('malformed_csv');
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
      closedQuote = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(cell);
      matrix.push(row);
      row = [];
      cell = '';
      closedQuote = false;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new ImportFileError('malformed_csv');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    matrix.push(row);
  }
  return buildRows(sourceName, matrix);
}

function spreadsheetValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Never evaluate formulas. ExcelJS only exposes a cached result; use it
    // when present and otherwise leave the cell empty.
    if ('formula' in record || 'sharedFormula' in record) {
      return spreadsheetValueToString(record.result);
    }
    if (typeof record.text === 'string') return record.text;
    if (Array.isArray(record.richText)) {
      return record.richText
        .map(part =>
          part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : ''
        )
        .join('');
    }
  }
  return String(value);
}

async function parseXlsxFile(file: File): Promise<ParsedImportFile> {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ImportFileError('workbook_empty');
  const matrix: string[][] = [];
  const sourceRowNumbers: number[] = [];
  worksheet.eachRow({ includeEmpty: false }, row => {
    if (row.cellCount > MAX_IMPORT_COLUMNS) {
      const hasOverflowValue = Array.from(
        { length: row.cellCount - MAX_IMPORT_COLUMNS },
        (_, index) => spreadsheetValueToString(row.getCell(MAX_IMPORT_COLUMNS + index + 1).value)
      ).some(value => value.trim().length > 0);
      if (hasOverflowValue) {
        throw new ImportFileError(matrix.length === 0 ? 'too_many_columns' : 'row_too_wide');
      }
    }
    const cells: string[] = [];
    for (let index = 1; index <= Math.min(row.cellCount, MAX_IMPORT_COLUMNS); index += 1) {
      cells.push(spreadsheetValueToString(row.getCell(index).value));
    }
    matrix.push(cells);
    sourceRowNumbers.push(row.number);
  });
  return buildRows(file.name, matrix, sourceRowNumbers);
}

export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new ImportFileError('file_too_large');
  const extension = file.name.split('.').at(-1)?.toLocaleLowerCase();
  if (extension === 'csv') return parseCsvText(await file.text(), file.name);
  if (extension === 'xlsx') return parseXlsxFile(file);
  throw new ImportFileError('unsupported_file');
}
