// CSV exporter (ENG-178 slice 30).

import { downloadFile, generateFilename } from './filename';
import { formatValue, getNestedValue } from './format';
import type { ExportColumn, ExportOptions } from './types';

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
        // Escape quotes and wrap in quotes for CSV safety
        return `"${formatted.replace(/"/g, '""')}"`;
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
