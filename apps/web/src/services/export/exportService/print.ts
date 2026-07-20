// Print-to-window exporter ( slice 30). Opens a transient Blob-backed
// window with an escapeHtml-guarded table for the browser print dialog.

import { openHtmlInPrintWindow } from '@/lib/printWindow';
import { escapeHtml } from './escape';
import { formatValue, getNestedValue } from './format';
import type { ExportColumn, ExportOptions } from './types';

/**
 * Print table data in a new window
 */
export function printTable<T extends object>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions = {}
): void {
  const { title } = options;
  const escapedTitle = title ? escapeHtml(title) : null;

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
      <title>${escapedTitle ?? 'Print'}</title>
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
        ${escapedTitle ? `<div class="title">${escapedTitle}</div>` : ''}
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

  const printWindow = openHtmlInPrintWindow(html);
  if (!printWindow) {
    console.error('Failed to open print window. Please allow popups for this site.');
  }
}
