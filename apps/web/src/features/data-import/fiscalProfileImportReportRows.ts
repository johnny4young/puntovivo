/** Row-complete fiscal-profile import report projection. */
import type {
  FiscalProfileImportIssue,
  FiscalProfileImportPreview,
  FiscalProfileImportReport,
} from './types';

export type FiscalProfileImportReportStatus = 'imported' | 'skipped' | 'invalid' | 'failed';

export interface FiscalProfileImportReportRow {
  countryCode: string;
  environment: string;
  issue: FiscalProfileImportIssue | null;
  rowNumber: number;
  status: FiscalProfileImportReportStatus;
  taxIdentifier: string;
}

export function buildFiscalProfileImportReportRows(
  preview: FiscalProfileImportPreview,
  report: FiscalProfileImportReport
): FiscalProfileImportReportRow[] {
  const importedByRow = new Map(report.importedRows.map(row => [row.rowNumber, row]));
  const skippedByRow = new Map(report.skippedRows.map(row => [row.rowNumber, row]));
  const invalidByRow = new Map(report.invalidRows.map(row => [row.rowNumber, row]));
  const failedByRow = new Map(report.failedRows.map(row => [row.rowNumber, row]));

  return preview.rows.flatMap<FiscalProfileImportReportRow>(row => {
    const imported = importedByRow.get(row.rowNumber);
    const skipped = skippedByRow.get(row.rowNumber);
    const invalid = invalidByRow.get(row.rowNumber);
    const failed = failedByRow.get(row.rowNumber);
    const issues =
      imported?.issues ?? skipped?.issues ?? invalid?.issues ?? failed?.issues ?? row.issues;
    const status: FiscalProfileImportReportStatus = imported
      ? 'imported'
      : skipped
        ? 'skipped'
        : invalid
          ? 'invalid'
          : failed
            ? 'failed'
            : row.status === 'invalid'
              ? 'invalid'
              : 'skipped';
    const base = {
      countryCode: row.normalized.countryCode ?? '',
      environment: row.normalized.environment,
      rowNumber: row.rowNumber,
      status,
      taxIdentifier: row.normalized.taxIdentifier,
    };
    return issues.length > 0
      ? issues.map(issue => ({ ...base, issue }))
      : [{ ...base, issue: null }];
  });
}
