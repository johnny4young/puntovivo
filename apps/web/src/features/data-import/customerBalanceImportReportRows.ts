/** ENG-123d — Row-complete customer receivable import report projection. */
import type {
  CustomerBalanceImportIssue,
  CustomerBalanceImportPreview,
  CustomerBalanceImportReport,
} from './types';

export type CustomerBalanceImportReportStatus = 'imported' | 'skipped' | 'invalid' | 'failed';

export interface CustomerBalanceImportReportExportRow {
  adjustmentId: string;
  customer: string;
  email: string;
  issue: CustomerBalanceImportIssue | null;
  openingBalance: number;
  rowNumber: number;
  status: CustomerBalanceImportReportStatus;
  taxId: string;
}

export function buildCustomerBalanceImportReportRows(
  preview: CustomerBalanceImportPreview,
  report: CustomerBalanceImportReport
): CustomerBalanceImportReportExportRow[] {
  const importedByRow = new Map(report.importedRows.map(row => [row.rowNumber, row]));
  const skippedByRow = new Map(report.skippedRows.map(row => [row.rowNumber, row]));
  const failedByRow = new Map(report.failedRows.map(row => [row.rowNumber, row]));

  return preview.rows.flatMap<CustomerBalanceImportReportExportRow>(row => {
    const imported = importedByRow.get(row.rowNumber);
    const skipped = skippedByRow.get(row.rowNumber);
    const failed = failedByRow.get(row.rowNumber);
    const issues = imported?.issues ?? skipped?.issues ?? failed?.issues ?? row.issues;
    const status: CustomerBalanceImportReportStatus = imported
      ? 'imported'
      : skipped
        ? 'skipped'
        : failed
          ? 'failed'
          : row.status === 'invalid'
            ? 'invalid'
            : 'skipped';
    const base = {
      adjustmentId: imported?.adjustmentId ?? '',
      customer: row.normalized.customerName ?? '',
      email: row.normalized.email ?? '',
      openingBalance: row.normalized.openingBalance,
      rowNumber: row.rowNumber,
      status,
      taxId: row.normalized.taxId ?? '',
    };
    return issues.length > 0
      ? issues.map(issue => ({ ...base, issue }))
      : [{ ...base, issue: null }];
  });
}
