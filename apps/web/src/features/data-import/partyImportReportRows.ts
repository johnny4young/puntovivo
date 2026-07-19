/** ENG-123b — Row-complete customer/provider report projection. */
import type { PartyImportIssue, PartyImportPreview, PartyImportReport } from './types';

export type PartyImportReportStatus = 'imported' | 'skipped' | 'invalid' | 'failed';

export interface PartyImportReportExportRow {
  email: string;
  issue: PartyImportIssue | null;
  name: string;
  recordId: string;
  rowNumber: number;
  status: PartyImportReportStatus;
  taxId: string;
}

export function buildPartyImportReportRows(
  preview: PartyImportPreview,
  report: PartyImportReport
): PartyImportReportExportRow[] {
  const importedByRow = new Map(report.importedRows.map(row => [row.rowNumber, row]));
  const skippedByRow = new Map(report.skippedRows.map(row => [row.rowNumber, row]));
  const failedByRow = new Map(report.failedRows.map(row => [row.rowNumber, row]));

  return preview.rows.flatMap<PartyImportReportExportRow>(row => {
    const imported = importedByRow.get(row.rowNumber);
    const skipped = skippedByRow.get(row.rowNumber);
    const failed = failedByRow.get(row.rowNumber);
    const issues = imported?.issues ?? skipped?.issues ?? failed?.issues ?? row.issues;
    const status: PartyImportReportStatus = imported
      ? 'imported'
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
      name: row.normalized.name,
      taxId: row.normalized.taxId ?? '',
      email: row.normalized.email ?? '',
      recordId: imported?.recordId ?? '',
    };
    return issues.length > 0
      ? issues.map(issue => ({ ...base, issue }))
      : [{ ...base, issue: null }];
  });
}
