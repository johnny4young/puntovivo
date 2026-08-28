import type { ExportColumn } from '@/services/export/exportService';
import {
  buildCSVBlob,
  downloadFile,
  exportToCSV,
  generateFilename,
} from '@/services/export/exportService';
import type { SiigoRow } from './accountingExportFormats';

export interface SiigoExportResult {
  fileCount: number;
  downloadedAsZip: boolean;
  filename: string | null;
}

/**
 * Download one CSV for a small period or one ZIP containing every capped CSV
 * part for a large period. One browser gesture therefore always creates at
 * most one download.
 */
export async function exportSiigoChunks(
  chunks: SiigoRow[][],
  columns: ExportColumn<SiigoRow>[],
  baseName: string
): Promise<SiigoExportResult> {
  if (chunks.length === 0) {
    return { fileCount: 0, downloadedAsZip: false, filename: null };
  }

  if (chunks.length === 1) {
    const filename = generateFilename(baseName, 'csv', false);
    exportToCSV(chunks[0]!, columns, baseName, { includeTimestamp: false });
    return { fileCount: 1, downloadedAsZip: false, filename };
  }

  // JSZip stays route-local: accounting export is lazy-loaded and operators
  // who never open it do not pay the parser cost in the application shell.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [index, chunk] of chunks.entries()) {
    const entryName = generateFilename(`${baseName}-parte-${index + 1}`, 'csv', false);
    const bytes = new Uint8Array(await buildCSVBlob(chunk, columns).arrayBuffer());
    zip.file(entryName, bytes);
  }

  const archive = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const filename = generateFilename(baseName, 'zip', false);
  downloadFile(archive, filename);
  return { fileCount: chunks.length, downloadedAsZip: true, filename };
}
