/**
 * Export Service
 * Provides functionality to export table data to various formats (CSV, Excel, PDF)
 * and print table data.
 */

export interface ExportColumn<T = unknown> {
  /** Column key/accessor */
  key: string;
  /** Display header for the column */
  header: string;
  /** Optional formatter function for cell values */
  formatter?: (value: unknown, row: T) => string;
}

export interface ExportOptions {
  /** Title for the export (used in PDF/Excel headers) */
  title?: string;
  /** Include timestamp in filename */
  includeTimestamp?: boolean;
  /** Date format for timestamps */
  dateFormat?: string;
}

/**
 * Get the value from an object using a dot-notation path
 */
function getNestedValue(obj: object, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

/**
 * Format a value for export
 */
function formatValue<T>(value: unknown, column: ExportColumn<T>, row: T): string {
  if (column.formatter) {
    return column.formatter(value, row);
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Generate a filename with optional timestamp
 */
function generateFilename(baseName: string, extension: string, includeTimestamp = true): string {
  const sanitizedName = baseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  if (includeTimestamp) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${sanitizedName}_${timestamp}.${extension}`;
  }
  return `${sanitizedName}.${extension}`;
}

/**
 * Trigger file download in the browser
 */
function downloadFile(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

  // Dynamically import exceljs to keep bundle size small
  const ExcelJS = await import('exceljs');

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
      let cellValue: string | number | boolean | Date | null = null;

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

  // Dynamically import jspdf and jspdf-autotable
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

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

  // Add table using autotable
  (doc as typeof jsPDF.prototype & { autoTable: (options: unknown) => void }).autoTable({
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

/**
 * Print table data in a new window
 */
export function printTable<T extends object>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions = {}
): void {
  const { title } = options;

  // Build HTML table
  const headers = columns.map(col => `<th>${escapeHtml(col.header)}</th>`).join('');

  const rows = data
    .map(row => {
      const cells = columns
        .map(col => {
          const value = getNestedValue(row, col.key);
          const formatted = formatValue(value, col, row);
          return `<td>${escapeHtml(formatted)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title || 'Print'}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          font-size: 12px;
          line-height: 1.5;
          padding: 20px;
          color: #1f2937;
        }
        .header {
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 2px solid #0ea5e9;
        }
        .title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 5px;
        }
        .timestamp {
          font-size: 11px;
          color: #6b7280;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
        }
        th, td {
          padding: 8px 12px;
          text-align: left;
          border: 1px solid #e5e7eb;
        }
        th {
          background-color: #0ea5e9;
          color: white;
          font-weight: 600;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.05em;
        }
        tr:nth-child(even) {
          background-color: #f9fafb;
        }
        tr:hover {
          background-color: #f3f4f6;
        }
        .footer {
          margin-top: 20px;
          padding-top: 10px;
          border-top: 1px solid #e5e7eb;
          font-size: 10px;
          color: #6b7280;
          text-align: center;
        }
        @media print {
          body { padding: 0; }
          .header { page-break-after: avoid; }
          tr { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        ${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}
        <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>
      </div>
      <table>
        <thead>
          <tr>${headers}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <div class="footer">
        Total Records: ${data.length}
      </div>
      <script>
        window.onload = function() {
          window.print();
          window.onafterprint = function() {
            window.close();
          };
        };
      </script>
    </body>
    </html>
  `;

  // Open print window
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  } else {
    console.error('Failed to open print window. Please allow popups for this site.');
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

/**
 * Export service object with all export methods
 */
export const exportService = {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  printTable,
};

export default exportService;
