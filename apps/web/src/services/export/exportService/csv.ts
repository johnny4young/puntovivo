// CSV exporter (ENG-178 slice 30).

import { downloadFile, generateFilename } from './filename';
import { formatValue, getNestedValue } from './format';
import type { ExportColumn, ExportOptions } from './types';

function neutralizeSpreadsheetFormula(value: unknown, formatted: string): string {
  // Excel-compatible CSV readers can execute text cells beginning with one
  // of these formula markers. Preserve genuine numeric negatives, but make
  // every formula-shaped text value explicit text by prefixing an apostrophe.
  return typeof value !== 'number' && /^[\s\u00a0]*[=+\-@]/.test(formatted)
    ? `'${formatted}`
    : formatted;
}

/**
 * Export data to CSV format
 */
export function exportToCSV<T extends object>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string,
  options: ExportOptions = {}
): void {
  const { includeTimestamp = true } = options;

  // Build header row
  const headers = columns.map(col => `"${col.header.replace(/"/g, '""')}"`);
  const headerRow = headers.join(',');

  // Build data rows
  const dataRows = data.map(row => {
    return columns
      .map(col => {
        const value = getNestedValue(row, col.key);
        const formatted = formatValue(value, col, row);
        const safe = neutralizeSpreadsheetFormula(value, formatted);
        // Escape quotes and wrap in quotes for CSV safety
        return `"${safe.replace(/"/g, '""')}"`;
      })
      .join(',');
  });

  // Combine header and data
  const csvContent = [headerRow, ...dataRows].join('\n');

  // Add BOM for Excel compatibility with UTF-8
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  const finalFilename = generateFilename(filename, 'csv', includeTimestamp);
  downloadFile(blob, finalFilename);
}
