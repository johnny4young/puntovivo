// PDF exporter via jspdf + jspdf-autotable v5 (ENG-178 slice 30).

import { generateFilename } from './filename';
import { formatValue, getNestedValue } from './format';
import type { ExportColumn, ExportOptions } from './types';

/**
 * Export data to PDF format using jspdf library
 * Note: Requires jspdf and jspdf-autotable libraries:
 * npm install jspdf jspdf-autotable
 */
export async function exportToPDF<T extends object>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string,
  options: ExportOptions = {}
): Promise<void> {
  const { title, includeTimestamp = true } = options;

  // Dynamically import jspdf and jspdf-autotable. As of jspdf-autotable v5
  // the plugin no longer patches the jsPDF prototype; it exports a named
  // function that takes the doc as its first argument. We keep both the
  // module default and the plugin function in scope below.
  const { default: jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  const autoTableExports = autoTableModule as unknown as {
    autoTable?: unknown;
    default?: unknown;
  };
  const autoTable =
    typeof autoTableExports.autoTable === 'function'
      ? autoTableExports.autoTable
      : autoTableExports.default;
  if (typeof autoTable !== 'function') {
    throw new Error('jspdf-autotable v5+ is required; no callable export found');
  }

  // Create PDF document
  const doc = new jsPDF({
    orientation: columns.length > 5 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Add title if provided
  let startY = 15;
  if (title) {
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 14, startY);
    startY += 10;
  }

  // Add timestamp
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(128);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, startY);
  startY += 8;

  // Prepare table data
  const headers = columns.map(col => col.header);
  const tableData = data.map(row =>
    columns.map(col => {
      const value = getNestedValue(row, col.key);
      return formatValue(value, col, row);
    })
  );

  // v5+ API: call `autoTable(doc, options)` rather than `doc.autoTable(options)`.
  const autoTableFn = autoTable as (
    doc: InstanceType<typeof jsPDF>,
    options: Record<string, unknown>
  ) => void;
  autoTableFn(doc, {
    head: [headers],
    body: tableData,
    startY,
    theme: 'striped',
    headStyles: {
      fillColor: [14, 165, 233], // Primary color (sky-500)
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: [51, 51, 51],
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251], // Gray-50
    },
    styles: {
      cellPadding: 3,
      lineColor: [229, 231, 235], // Gray-200
      lineWidth: 0.1,
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data: { pageNumber: number }) => {
      // Add page number footer
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(128);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 10,
        { align: 'center' }
      );
    },
  });

  const finalFilename = generateFilename(filename, 'pdf', includeTimestamp);
  doc.save(finalFilename);
}
