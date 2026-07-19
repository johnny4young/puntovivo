/** ENG-123a — Pure row projection for the downloadable post-import report. */
import type { ProductImportIssue, ProductImportPreview, ProductImportReport } from './types';

export type ProductImportReportStatus =
  'imported' | 'importedWithWarnings' | 'skipped' | 'invalid' | 'failed';

export interface ProductImportReportExportRow {
  rowNumber: number;
  status: ProductImportReportStatus;
  sku: string;
  productId: string;
  stockInitialized: boolean | null;
  issue: ProductImportIssue | null;
}

export function buildProductImportReportRows(
  preview: ProductImportPreview,
  report: ProductImportReport
): ProductImportReportExportRow[] {
  const importedByRow = new Map(report.importedRows.map(row => [row.rowNumber, row]));
  const skippedByRow = new Map(report.skippedRows.map(row => [row.rowNumber, row]));
  const failedByRow = new Map(report.failedRows.map(row => [row.rowNumber, row]));

  return preview.rows.flatMap<ProductImportReportExportRow>(row => {
    const imported = importedByRow.get(row.rowNumber);
    const skipped = skippedByRow.get(row.rowNumber);
    const failed = failedByRow.get(row.rowNumber);
    const issues = imported?.issues ?? skipped?.issues ?? failed?.issues ?? row.issues;
    const status: ProductImportReportStatus = imported
      ? imported.issues.length > 0
        ? 'importedWithWarnings'
        : 'imported'
      : skipped
        ? 'skipped'
        : failed
          ? 'failed'
          : row.status === 'invalid'
            ? 'invalid'
            : 'skipped';
    const base = {
      rowNumber: row.rowNumber,
      status,
      sku: row.normalized.sku,
      productId: imported?.productId ?? '',
      stockInitialized: imported?.stockInitialized ?? null,
    };

    return issues.length > 0
      ? issues.map(issue => ({ ...base, issue }))
      : [{ ...base, issue: null }];
  });
}
