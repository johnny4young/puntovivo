// Public barrel for the table export service ( slice 30). Re-exports
// ONLY the public surface; the internal helpers getNestedValue / formatValue /
// escapeHtml / DOWNLOAD_URL_REVOKE_DELAY_MS stay module-private.

export type { ExportColumn, ExportOptions, SemanticExportKind } from './types';
export { MIME_BY_EXT, mimeTypeForExtension } from './mime';
export type { SupportedExportExtension } from './mime';
export { buildSemanticFilename, downloadFile, generateFilename } from './filename';
export { exportToCSV } from './csv';
export { exportToExcel } from './excel';
export { exportToPDF } from './pdf';
export { printTable } from './print';

import { exportToCSV } from './csv';
import { exportToExcel } from './excel';
import { exportToPDF } from './pdf';
import { printTable } from './print';

/**
 * Export service object with all export methods
 */
export const exportService = {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  printTable,
};
