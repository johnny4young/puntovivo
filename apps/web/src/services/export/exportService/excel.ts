// Excel exporter via the prebundled browser ExcelJS bundle (ENG-178 slice 30).

import { downloadFile, generateFilename } from './filename';
import { formatValue, getNestedValue } from './format';
import type { ExportColumn, ExportOptions } from './types';

/**
 * Export data to Excel format using ExcelJS library
 * Note: Requires exceljs library to be installed: npm install exceljs
 */
export async function exportToExcel<T extends object>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string,
  options: ExportOptions = {}
): Promise<void> {
  const { title, includeTimestamp = true } = options;

  // Use the prebundled browser bundle that already strips the CSV writer
  // and its `@fast-csv/format` dependency. The source-level
  // `exceljs/lib/exceljs.bare.js` entry transitively imports
  // `CsvFormatterStream`, which extends Node's `Transform` stream — that
  // class is undefined in the browser and crashes the entire export at
  // import time (symptom: file downloaded without an extension because the
  // anchor click never fired). `exceljs/dist/exceljs.bare.min.js` is the
  // official pre-built browser-only bundle with CSV + streams removed.
  // The module shape is declared in `types/exceljs-browser.d.ts`.
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');

  // Create a new workbook and worksheet
  const workbook = new ExcelJS.Workbook();
  const sheetName = title ? title.slice(0, 31) : 'Data'; // Excel limits sheet name to 31 chars
  const worksheet = workbook.addWorksheet(sheetName);

  let currentRow = 1;

  // Add title row if provided
  if (title) {
    worksheet.mergeCells(currentRow, 1, currentRow, columns.length);
    const titleCell = worksheet.getCell(currentRow, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };
    currentRow += 2; // Skip a row for spacing
  }

  // Add header row
  const headerRow = worksheet.getRow(currentRow);
  columns.forEach((col, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = col.header;
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  });
  currentRow++;

  // Add data rows
  data.forEach(row => {
    const dataRow = worksheet.getRow(currentRow);
    columns.forEach((col, index) => {
      const value = getNestedValue(row, col.key);
      let cellValue: string | number | boolean | Date | null;

      if (col.formatter) {
        cellValue = col.formatter(value, row);
      } else if (value === null || value === undefined) {
        cellValue = null;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        cellValue = value;
      } else if (value instanceof Date) {
        cellValue = value;
      } else {
        cellValue = String(value);
      }

      dataRow.getCell(index + 1).value = cellValue;
    });
    currentRow++;
  });

  // Auto-fit columns based on content
  worksheet.columns.forEach((column, index) => {
    if (column) {
      let maxLength = columns[index]?.header.length || 10;
      data.forEach(row => {
        const value = getNestedValue(row, columns[index]?.key || '');
        const formatted = formatValue(value, columns[index]!, row);
        maxLength = Math.max(maxLength, formatted.length);
      });
      column.width = Math.min(maxLength + 2, 50); // Cap at 50 characters
    }
  });

  // Generate Excel file
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const finalFilename = generateFilename(filename, 'xlsx', includeTimestamp);
  downloadFile(blob, finalFilename);
}
