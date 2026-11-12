import type { TFunction } from 'i18next';
import type { FiscalProfileImportIssue } from './types';

/** Localized issue text shared by the preview table and the CSV exports. */
export function fiscalProfileIssueText(t: TFunction, issue: FiscalProfileImportIssue): string {
  const key = `dataImport:fiscalProfiles.issues.${issue.code}`;
  return issue.code === 'invalid_check_digit' ? t(key, { digit: issue.expectedDigit }) : t(key);
}
