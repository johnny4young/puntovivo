/** Row-complete opening-cash import report projection. */
import type {
  OpeningCashImportIssue,
  OpeningCashImportPreview,
  OpeningCashImportReport,
} from './types';

export type OpeningCashImportReportStatus = 'imported' | 'skipped' | 'invalid' | 'failed';

export interface OpeningCashImportReportExportRow {
  denominations: string;
  issue: OpeningCashImportIssue | null;
  openingFloat: number;
  registerName: string;
  rowNumber: number;
  siteName: string;
  status: OpeningCashImportReportStatus;
  templateId: string;
}

export function serializeOpeningCashDenominations(
  denominations: ReadonlyArray<{ value: number; count: number }>
) {
  return denominations.map(item => `${item.value}:${item.count}`).join(';');
}

export function buildOpeningCashImportReportRows(
  preview: OpeningCashImportPreview,
  report: OpeningCashImportReport
): OpeningCashImportReportExportRow[] {
  const importedByRow = new Map(report.importedRows.map(row => [row.rowNumber, row]));
  const skippedByRow = new Map(report.skippedRows.map(row => [row.rowNumber, row]));
  const invalidByRow = new Map(report.invalidRows.map(row => [row.rowNumber, row]));
  const failedByRow = new Map(report.failedRows.map(row => [row.rowNumber, row]));

  return preview.rows.flatMap<OpeningCashImportReportExportRow>(row => {
    const imported = importedByRow.get(row.rowNumber);
    const skipped = skippedByRow.get(row.rowNumber);
    const invalid = invalidByRow.get(row.rowNumber);
    const failed = failedByRow.get(row.rowNumber);
    const issues =
      imported?.issues ?? skipped?.issues ?? invalid?.issues ?? failed?.issues ?? row.issues;
    const status: OpeningCashImportReportStatus = imported
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
      denominations: serializeOpeningCashDenominations(row.normalized.denominations),
      openingFloat: row.normalized.openingFloat,
      registerName: row.normalized.registerName,
      rowNumber: row.rowNumber,
      siteName: row.normalized.siteName,
      status,
      templateId: imported?.templateId ?? '',
    };
    return issues.length > 0
      ? issues.map(issue => ({ ...base, issue }))
      : [{ ...base, issue: null }];
  });
}
